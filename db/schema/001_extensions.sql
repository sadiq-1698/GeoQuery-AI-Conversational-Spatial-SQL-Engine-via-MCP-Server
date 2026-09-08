-- Core spatial types/functions (ST_DWithin, ST_Distance, geography casts, etc.)
CREATE EXTENSION IF NOT EXISTS postgis;

-- Topology support, not required by the current tools but commonly needed
-- alongside PostGIS for more advanced spatial validation later.
CREATE EXTENSION IF NOT EXISTS postgis_topology;
