-- osm2pgsql flex-output tag-transform script for osm_pois.
--
-- Maps a curated set of OSM tags into the normalized `category` vocabulary
-- (hospital, school, restaurant, cafe, park, transit_stop, shop, other) and
-- writes into two STAGING tables (nodes and closed ways), merged into the
-- real osm_pois table (db/schema/002_osm_pois.sql) by load_osm.sh after this
-- runs. Every row is tagged with GEOQUERY_REGION (set by load_osm.sh) so
-- multiple cities can coexist in the same table.
--
-- Both verified against a real osm2pgsql 1.6.0 install (Session 17), not
-- just read from docs:
--
-- 1. This API has no object:as_point()/as_polygon() method at all —
--    introspecting a live node/way object directly showed only
--    get_bbox/grab_tag. Geometry instead auto-populates on add_row() based
--    on matching the table's `ids.type` to the target column's geometry
--    type: a node-ids table with a 'point' column gets the node's location
--    for free; a way-ids table always gets a LineString (never a polygon,
--    even for a closed way) — hence the separate way staging table,
--    finished off (LineString -> polygon -> centroid) in SQL by
--    load_osm.sh.
--
-- 2. osm2pgsql's --create flag DROPS AND RECREATES every table this script
--    defines, even one that already exists with a different structure —
--    confirmed the hard way: it silently replaced osm_pois's real schema
--    (primary key, category/region/tags indexes, import_batch default)
--    with a bare id/geom-index-only structure. Writing here to disposable
--    staging tables instead — always safe to --create, since nothing
--    depends on their structure surviving between runs — and merging into
--    the real, pre-provisioned schema via SQL sidesteps that entirely.

local region = os.getenv('GEOQUERY_REGION')
if not region then
    error('GEOQUERY_REGION environment variable must be set (see load_osm.sh)')
end

local osm_pois_node_staging = osm2pgsql.define_table({
    name = 'osm_pois_node_staging',
    ids = { type = 'node', id_column = 'id' },
    columns = {
        { column = 'name',     type = 'text' },
        { column = 'category', type = 'text', not_null = true },
        { column = 'amenity',  type = 'text' },
        { column = 'tags',     type = 'jsonb', not_null = true },
        { column = 'region',   type = 'text', not_null = true },
        { column = 'geom',     type = 'point', not_null = true, projection = 4326 },
    },
})

local osm_pois_way_staging = osm2pgsql.define_table({
    name = 'osm_pois_way_staging',
    ids = { type = 'way', id_column = 'id' },
    columns = {
        { column = 'name',     type = 'text' },
        { column = 'category', type = 'text', not_null = true },
        { column = 'amenity',  type = 'text' },
        { column = 'tags',     type = 'jsonb', not_null = true },
        { column = 'region',   type = 'text', not_null = true },
        { column = 'geom',     type = 'linestring', not_null = true, projection = 4326 },
    },
})

-- Raw OSM tag value -> normalized category. Anything not listed falls
-- through to 'other' (and is only kept if some POI-shaped tag exists at all,
-- see `categorize` below) so we don't import every tagged node/way in the
-- extract as noise.
local CATEGORY_MAP = {
    hospital = 'hospital', clinic = 'hospital', doctors = 'hospital', pharmacy = 'hospital',
    school = 'school', university = 'school', college = 'school', kindergarten = 'school',
    restaurant = 'restaurant', fast_food = 'restaurant', food_court = 'restaurant',
    cafe = 'cafe',
    park = 'park',
    bus_station = 'transit_stop', subway_entrance = 'transit_stop',
}

local function categorize(tags)
    local amenity = tags.amenity or tags.leisure
    if amenity and CATEGORY_MAP[amenity] then
        return CATEGORY_MAP[amenity], amenity
    end
    if tags.shop then
        return 'shop', tags.shop
    end
    if tags.railway == 'station' or tags.public_transport then
        return 'transit_stop', tags.railway or tags.public_transport
    end
    if amenity then
        return 'other', amenity
    end
    return nil, nil -- not a POI we care about
end

local function process(table_ref, object)
    local category, amenity = categorize(object.tags)
    if not category then
        return
    end
    table_ref:add_row({
        id = object.id,
        name = object.tags.name,
        category = category,
        amenity = amenity,
        tags = object.tags,
        region = region,
    })
end

function osm2pgsql.process_node(object)
    process(osm_pois_node_staging, object)
end

function osm2pgsql.process_way(object)
    if not object.is_closed then
        return -- POIs are tagged points or closed areas (e.g. a hospital
                -- building polygon); open ways (roads, paths) are out of scope.
    end
    process(osm_pois_way_staging, object)
end
