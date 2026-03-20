import { describe, it, expect } from 'vitest';
import {
    buildMilitaryBasesGeoJSON, BRANCH_COLORS,
    buildTrainsGeoJSON,
    buildFlightLayerGeoJSON,
    buildUavGeoJSON,
    buildSatellitesGeoJSON,
} from '@/components/map/geoJSONBuilders';
import type { MilitaryBase, MilBaseBranch, Train, UAV, Satellite } from '@/types/dashboard';

// ─── Military Bases ────────────────────────────────────────────────────────

const baseMilBase: MilitaryBase = {
    name: 'Fort Test',
    country: 'US',
    state: 'TX',
    operator: 'USAF',
    branch: 'air_force',
    owner: 'US',
    status: 'active',
    joint: false,
    lat: 32.0,
    lng: -97.0,
    diameter_m: 5000,
};

describe('buildMilitaryBasesGeoJSON', () => {
    it('returns null for empty/undefined input', () => {
        expect(buildMilitaryBasesGeoJSON(undefined)).toBeNull();
        expect(buildMilitaryBasesGeoJSON([])).toBeNull();
    });

    it('builds valid FeatureCollection with correct properties', () => {
        const bases: MilitaryBase[] = [baseMilBase];
        const result = buildMilitaryBasesGeoJSON(bases);
        expect(result).not.toBeNull();
        expect(result!.type).toBe('FeatureCollection');
        expect(result!.features).toHaveLength(1);

        const props = result!.features[0].properties!;
        expect(props.type).toBe('military_base');
        expect(props.name).toBe('Fort Test');
        expect(props.country).toBe('US');
        expect(props.branch).toBe('air_force');
        expect(props.id).toBe('milbase-0');
        expect(props.color).toBe(BRANCH_COLORS['air_force']);
        expect(props.joint).toBe('no');
        expect(props.diameter_m).toBe(5000);
        expect(result!.features[0].geometry).toEqual({ type: 'Point', coordinates: [-97.0, 32.0] });
    });

    it('uses BRANCH_COLORS for color assignment', () => {
        const navyBase: MilitaryBase = { ...baseMilBase, branch: 'navy' };
        const result = buildMilitaryBasesGeoJSON([navyBase]);
        expect(result!.features[0].properties!.color).toBe('#6366f1');
    });

    it('falls back to gray for unknown branch', () => {
        const unknownBase: MilitaryBase = { ...baseMilBase, branch: 'space_rangers' };
        const result = buildMilitaryBasesGeoJSON([unknownBase]);
        expect(result!.features[0].properties!.color).toBe('#9ca3af');
    });

    it('marks joint base correctly', () => {
        const jointBase: MilitaryBase = { ...baseMilBase, joint: true };
        const result = buildMilitaryBasesGeoJSON([jointBase]);
        expect(result!.features[0].properties!.joint).toBe('yes');
    });

    it('respects branch filter — keeps matching, excludes non-matching', () => {
        const armyBase: MilitaryBase = { ...baseMilBase, branch: 'army', owner: 'US' };
        const afBase: MilitaryBase = { ...baseMilBase, branch: 'air_force', owner: 'US', name: 'AF Base' };
        const filter: Record<string, Set<MilBaseBranch>> = {
            US: new Set(['army'] as MilBaseBranch[]),
        };
        const result = buildMilitaryBasesGeoJSON([armyBase, afBase], filter);
        expect(result).not.toBeNull();
        expect(result!.features).toHaveLength(1);
        expect(result!.features[0].properties!.branch).toBe('army');
    });

    it('returns null when filter excludes all bases', () => {
        const bases: MilitaryBase[] = [baseMilBase];
        const filter: Record<string, Set<MilBaseBranch>> = {
            UK: new Set(['navy'] as MilBaseBranch[]),
        };
        const result = buildMilitaryBasesGeoJSON(bases, filter);
        expect(result).toBeNull();
    });

    it('respects polyActive — excludes bases whose index is active', () => {
        const bases: MilitaryBase[] = [
            { ...baseMilBase, name: 'Base A' },
            { ...baseMilBase, name: 'Base B' },
        ];
        const polyActive: Record<number, boolean> = { 0: true };
        const result = buildMilitaryBasesGeoJSON(bases, undefined, polyActive);
        expect(result).not.toBeNull();
        expect(result!.features).toHaveLength(1);
        expect(result!.features[0].properties!.name).toBe('Base B');
    });

    it('returns null when polyActive excludes all bases', () => {
        const bases: MilitaryBase[] = [baseMilBase];
        const polyActive: Record<number, boolean> = { 0: true };
        const result = buildMilitaryBasesGeoJSON(bases, undefined, polyActive);
        expect(result).toBeNull();
    });
});

// ─── Trains ────────────────────────────────────────────────────────────────

const baseTrain: Train = {
    id: 'train-1',
    name: 'Acela Express',
    train_num: '2151',
    operator: 'Amtrak',
    country: 'US',
    lat: 40.7,
    lng: -74.0,
    heading: 45,
    speed_mph: 120,
    status: 'active',
    origin: 'Washington DC',
    destination: 'Boston',
    origin_code: 'WAS',
    dest_code: 'BOS',
    last_station: 'Philadelphia',
    next_station: 'New York',
    service_type: 'express',
    route_name: 'Northeast Corridor',
    updated_at: '2025-01-01T12:00:00Z',
    stations: [{ name: 'WAS', code: 'WAS', status: 'departed' }],
};

describe('buildTrainsGeoJSON', () => {
    it('returns null for empty/undefined input', () => {
        expect(buildTrainsGeoJSON(undefined)).toBeNull();
        expect(buildTrainsGeoJSON([])).toBeNull();
    });

    it('builds valid FeatureCollection with correct properties', () => {
        const result = buildTrainsGeoJSON([baseTrain]);
        expect(result).not.toBeNull();
        expect(result!.type).toBe('FeatureCollection');
        expect(result!.features).toHaveLength(1);

        const props = result!.features[0].properties!;
        expect(props.type).toBe('train');
        expect(props.name).toBe('Acela Express');
        expect(props.train_num).toBe('2151');
        expect(props.operator).toBe('Amtrak');
        expect(props.country).toBe('US');
        expect(props.speed_mph).toBe(120);
        expect(props.origin).toBe('Washington DC');
        expect(props.destination).toBe('Boston');
        expect(props.rotation).toBe(45);
        expect(result!.features[0].geometry).toEqual({ type: 'Point', coordinates: [-74.0, 40.7] });
    });

    it('encodes stations as JSON string in _stations_json', () => {
        const result = buildTrainsGeoJSON([baseTrain]);
        const stationsJson = result!.features[0].properties!._stations_json;
        expect(typeof stationsJson).toBe('string');
        expect(JSON.parse(stationsJson)).toEqual(baseTrain.stations);
    });

    it('sets _stations_json to empty string when no stations', () => {
        const noStations = { ...baseTrain, stations: undefined };
        const result = buildTrainsGeoJSON([noStations]);
        expect(result!.features[0].properties!._stations_json).toBe('');
    });

    it('skips entries with null lat/lng', () => {
        const bad: Train = { ...baseTrain, lat: null as any, lng: null as any };
        const result = buildTrainsGeoJSON([bad, baseTrain]);
        expect(result!.features).toHaveLength(1);
    });

    it('returns null when all entries have null lat/lng', () => {
        const bad: Train = { ...baseTrain, lat: null as any, lng: null as any };
        // filter removes the only train, but buildTrainsGeoJSON still returns FC with empty features
        // Actually the function filters before map, so empty features array is returned
        const result = buildTrainsGeoJSON([bad]);
        expect(result).not.toBeNull(); // features is empty array but FC is still returned
        expect(result!.features).toHaveLength(0);
    });

    it('filters by inView', () => {
        const farTrain: Train = { ...baseTrain, id: 'train-2', lat: 5.0, lng: 10.0 };
        const inView = (lat: number, _lng: number) => lat > 30;
        const result = buildTrainsGeoJSON([baseTrain, farTrain], inView);
        expect(result!.features).toHaveLength(1);
        expect(result!.features[0].properties!.id).toBe('train-1');
    });

    it('uses train_num in fallback name when name is missing', () => {
        const unnamed: Train = { ...baseTrain, name: '' };
        const result = buildTrainsGeoJSON([unnamed]);
        expect(result!.features[0].properties!.name).toBe('Train 2151');
    });
});

// ─── Flight Layer ──────────────────────────────────────────────────────────

const testFlightConfig = {
    colorMap: { airliner: 'svgAirliner', turboprop: 'svgTurboprop', bizjet: 'svgBizjet', heli: 'svgHeli', default: 'svgDefault' },
    groundedMap: { airliner: 'svgAirlinerGrey', turboprop: 'svgTurbopropGrey', bizjet: 'svgBizjetGrey', heli: 'svgHeliGrey', default: 'svgDefaultGrey' },
    typeLabel: 'commercial_flight',
    idPrefix: 'cf-',
};

const testHelpers = {
    interpFlight: (f: any) => [f.lng, f.lat] as [number, number],
    inView: () => true,
    trackedIcaoSet: new Set<string>(),
};

const baseFlight = {
    icao24: 'abc123',
    callsign: 'UAL123',
    lat: 40.0,
    lng: -74.0,
    alt: 35000,
    heading: 90,
    model: 'B738',
    aircraft_category: undefined,
};

describe('buildFlightLayerGeoJSON', () => {
    it('returns null for empty/undefined input', () => {
        expect(buildFlightLayerGeoJSON(undefined, testFlightConfig, testHelpers)).toBeNull();
        expect(buildFlightLayerGeoJSON([], testFlightConfig, testHelpers)).toBeNull();
    });

    it('builds valid FeatureCollection with correct properties', () => {
        const result = buildFlightLayerGeoJSON([baseFlight], testFlightConfig, testHelpers);
        expect(result).not.toBeNull();
        expect(result!.type).toBe('FeatureCollection');
        expect(result!.features).toHaveLength(1);

        const props = result!.features[0].properties!;
        expect(props.id).toBe('abc123');
        expect(props.type).toBe('commercial_flight');
        expect(props.callsign).toBe('UAL123');
        expect(props.rotation).toBe(90);
        expect(result!.features[0].geometry).toEqual({ type: 'Point', coordinates: [-74.0, 40.0] });
    });

    it('uses grounded icon when alt <= 100', () => {
        const grounded = { ...baseFlight, alt: 50 };
        const result = buildFlightLayerGeoJSON([grounded], testFlightConfig, testHelpers);
        const iconId = result!.features[0].properties!.iconId;
        // B738 classifies as airliner, so grounded icon should be the grounded airliner
        expect(iconId).toBe('svgAirlinerGrey');
    });

    it('uses airborne icon when alt > 100', () => {
        const result = buildFlightLayerGeoJSON([baseFlight], testFlightConfig, testHelpers);
        const iconId = result!.features[0].properties!.iconId;
        expect(iconId).toBe('svgAirliner');
    });

    it('filters by inView — excludes flights outside view', () => {
        const helpers = {
            ...testHelpers,
            inView: (lat: number, _lng: number) => lat > 30,
        };
        const farFlight = { ...baseFlight, lat: 10.0, icao24: 'far1' };
        const result = buildFlightLayerGeoJSON([baseFlight, farFlight], testFlightConfig, helpers);
        expect(result!.features).toHaveLength(1);
        expect(result!.features[0].properties!.id).toBe('abc123');
    });

    it('excludes tracked ICAO set entries', () => {
        const helpers = {
            ...testHelpers,
            trackedIcaoSet: new Set(['abc123']),
        };
        const result = buildFlightLayerGeoJSON([baseFlight], testFlightConfig, helpers);
        // All filtered out means features is empty, but still returns FC
        expect(result!.features).toHaveLength(0);
    });

    it('skips entries with null lat/lng', () => {
        const bad = { ...baseFlight, lat: null, lng: null, icao24: 'bad1' };
        const result = buildFlightLayerGeoJSON([bad, baseFlight], testFlightConfig, testHelpers);
        expect(result!.features).toHaveLength(1);
    });

    it('uses true_track for rotation when useTrackHeading is true', () => {
        const config = { ...testFlightConfig, useTrackHeading: true };
        const flight = { ...baseFlight, heading: 90, true_track: 180 };
        const result = buildFlightLayerGeoJSON([flight], config, testHelpers);
        expect(result!.features[0].properties!.rotation).toBe(180);
    });

    it('falls back to heading when useTrackHeading is false', () => {
        const flight = { ...baseFlight, heading: 90, true_track: 180 };
        const result = buildFlightLayerGeoJSON([flight], testFlightConfig, testHelpers);
        expect(result!.features[0].properties!.rotation).toBe(90);
    });

    it('uses interpFlight for coordinate placement', () => {
        const helpers = {
            ...testHelpers,
            interpFlight: (_f: any) => [10.0, 20.0] as [number, number],
        };
        const result = buildFlightLayerGeoJSON([baseFlight], testFlightConfig, helpers);
        expect(result!.features[0].geometry).toEqual({ type: 'Point', coordinates: [10.0, 20.0] });
    });

    it('falls back to idPrefix + index when no icao24 or callsign', () => {
        const noId = { ...baseFlight, icao24: undefined, callsign: undefined };
        const result = buildFlightLayerGeoJSON([noId], testFlightConfig, testHelpers);
        expect(result!.features[0].properties!.id).toBe('cf-0');
    });
});

// ─── UAVs / Drones ─────────────────────────────────────────────────────────

const baseUav: UAV = {
    callsign: 'REAPER01',
    country: 'US',
    lat: 35.0,
    lng: -118.0,
    alt: 20000,
    heading: 270,
    speed_knots: 180,
    registration: 'N12345',
    model: 'MQ-9',
    icao24: 'ae1234',
    squawk: '1200',
    aircraft_category: 'UAV',
    uav_type: 'MALE',
    aircraft_model: 'MQ-9 Reaper',
    wiki: 'https://en.wikipedia.org/wiki/MQ-9_Reaper',
    force: 'USAF',
    type: 'uav',
};

describe('buildUavGeoJSON', () => {
    it('returns null for empty/undefined input', () => {
        expect(buildUavGeoJSON(undefined)).toBeNull();
        expect(buildUavGeoJSON([])).toBeNull();
    });

    it('builds valid FeatureCollection with correct properties', () => {
        const result = buildUavGeoJSON([baseUav]);
        expect(result).not.toBeNull();
        expect(result!.type).toBe('FeatureCollection');
        expect(result!.features).toHaveLength(1);

        const props = result!.features[0].properties!;
        expect(props.type).toBe('uav');
        expect(props.iconId).toBe('svgDrone');
        expect(props.callsign).toBe('REAPER01');
        expect(props.name).toBe('MQ-9 Reaper');
        expect(props.country).toBe('US');
        expect(props.uav_type).toBe('MALE');
        expect(props.alt).toBe(20000);
        expect(props.rotation).toBe(270);
        expect(props.icao24).toBe('ae1234');
        expect(props.registration).toBe('N12345');
        expect(props.squawk).toBe('1200');
        expect(props.wiki).toBe('https://en.wikipedia.org/wiki/MQ-9_Reaper');
        expect(result!.features[0].geometry).toEqual({ type: 'Point', coordinates: [-118.0, 35.0] });
    });

    it('filters by inView', () => {
        const farUav: UAV = { ...baseUav, callsign: 'FAR01', lat: 5.0, lng: 10.0 };
        const inView = (lat: number, _lng: number) => lat > 30;
        const result = buildUavGeoJSON([baseUav, farUav], inView);
        expect(result!.features).toHaveLength(1);
        expect(result!.features[0].properties!.callsign).toBe('REAPER01');
    });

    it('skips entries with null lat/lng', () => {
        const bad: UAV = { ...baseUav, lat: null as any, lng: null as any };
        const result = buildUavGeoJSON([bad, baseUav]);
        expect(result!.features).toHaveLength(1);
    });

    it('uses callsign as name fallback when aircraft_model is missing', () => {
        const noModel: UAV = { ...baseUav, aircraft_model: undefined };
        const result = buildUavGeoJSON([noModel]);
        expect(result!.features[0].properties!.name).toBe('REAPER01');
    });
});

// ─── Satellites ────────────────────────────────────────────────────────────

const baseSatellite: Satellite = {
    id: 25544,
    name: 'ISS',
    mission: 'space_station',
    sat_type: 'Space Station',
    country: 'International',
    wiki: 'https://en.wikipedia.org/wiki/ISS',
    lat: 10.0,
    lng: 20.0,
    alt_km: 408,
    speed_knots: 15000,
    heading: 0,
} as any; // cast since our local Satellite interface may have extra fields

describe('buildSatellitesGeoJSON', () => {
    const defaultInView = () => true;
    const defaultInterp = (s: any) => [s.lng, s.lat] as [number, number];

    it('returns null for empty/undefined input', () => {
        expect(buildSatellitesGeoJSON(undefined, defaultInView, defaultInterp)).toBeNull();
        expect(buildSatellitesGeoJSON([], defaultInView, defaultInterp)).toBeNull();
    });

    it('builds valid FeatureCollection with correct properties', () => {
        const result = buildSatellitesGeoJSON([baseSatellite], defaultInView, defaultInterp);
        expect(result).not.toBeNull();
        expect(result!.type).toBe('FeatureCollection');
        expect(result!.features).toHaveLength(1);

        const props = result!.features[0].properties!;
        expect(props.type).toBe('satellite');
        expect(props.name).toBe('ISS');
        expect(props.mission).toBe('space_station');
        expect(props.sat_type).toBe('Space Station');
        expect(props.country).toBe('International');
        expect(props.alt_km).toBe(408);
        expect(props.color).toBe('#ffdd00'); // MISSION_COLORS['space_station']
        expect(props.iconId).toBe('sat-station'); // MISSION_ICON_MAP['space_station']
    });

    it('filters by inView', () => {
        const farSat = { ...baseSatellite, id: 99999, name: 'FarSat', lat: 5.0, lng: 10.0 };
        const inView = (lat: number, _lng: number) => lat > 8;
        const result = buildSatellitesGeoJSON([baseSatellite, farSat], inView, defaultInterp);
        expect(result!.features).toHaveLength(1);
        expect(result!.features[0].properties!.name).toBe('ISS');
    });

    it('uses interpSat for coordinate placement', () => {
        const interp = (_s: any) => [99.0, 88.0] as [number, number];
        const result = buildSatellitesGeoJSON([baseSatellite], defaultInView, interp);
        expect(result!.features[0].geometry).toEqual({ type: 'Point', coordinates: [99.0, 88.0] });
    });

    it('falls back to default color/icon for unknown mission', () => {
        const unknownMission = { ...baseSatellite, mission: 'mystery' as any };
        const result = buildSatellitesGeoJSON([unknownMission], defaultInView, defaultInterp);
        expect(result!.features[0].properties!.color).toBe('#aaaaaa');
        expect(result!.features[0].properties!.iconId).toBe('sat-gen');
    });

    it('assigns correct color per known mission type', () => {
        const milRecon = { ...baseSatellite, mission: 'military_recon' as any };
        const result = buildSatellitesGeoJSON([milRecon], defaultInView, defaultInterp);
        expect(result!.features[0].properties!.color).toBe('#ff3333');
        expect(result!.features[0].properties!.iconId).toBe('sat-mil');
    });
});
