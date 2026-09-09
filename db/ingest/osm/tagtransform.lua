-- osm2pgsql flex-output tag-transform script for osm_pois.
--
-- Maps a curated set of OSM tags into the normalized `category` vocabulary
-- (hospital, school, restaurant, cafe, park, transit_stop, shop, other) and
-- writes directly into the osm_pois table defined in
-- db/schema/002_osm_pois.sql, tagging every row with GEOQUERY_REGION (set by
-- load_osm.sh) so multiple cities can coexist in the same table.
--
-- NOTE: the flex output Lua API has changed across osm2pgsql major versions.
-- This script targets the documented API as of osm2pgsql 1.8+; verify
-- osm2pgsql.define_table()/object:as_point() etc. against your installed
-- version's docs (https://osm2pgsql.org/doc/manual.html) if it errors.

local region = os.getenv('GEOQUERY_REGION')
if not region then
    error('GEOQUERY_REGION environment variable must be set (see load_osm.sh)')
end

local osm_pois = osm2pgsql.define_table({
    name = 'osm_pois',
    ids = { type = 'any', id_column = 'id' },
    columns = {
        { column = 'name',     type = 'text' },
        { column = 'category', type = 'text', not_null = true },
        { column = 'amenity',  type = 'text' },
        { column = 'tags',     type = 'jsonb', not_null = true },
        { column = 'region',   type = 'text', not_null = true },
        { column = 'geom',     type = 'point', not_null = true, projection = 4326 },
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

local function process(object, geom)
    if not geom then
        return
    end
    local category, amenity = categorize(object.tags)
    if not category then
        return
    end
    osm_pois:insert({
        id = object.id,
        name = object.tags.name,
        category = category,
        amenity = amenity,
        tags = object.tags,
        region = region,
        geom = geom,
    })
end

function osm2pgsql.process_node(object)
    process(object, object:as_point())
end

function osm2pgsql.process_way(object)
    if not object.is_closed then
        return -- POIs are tagged points or closed areas (e.g. a hospital
                -- building polygon); open ways (roads, paths) are out of scope.
    end
    local polygon = object:as_polygon()
    if polygon then
        process(object, polygon:centroid())
    end
end
