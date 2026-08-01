import type { CurrentLocationView } from "../location/types";

export type LocationQueryIntent =
  | "where_is_employee"
  | "all_locations"
  | "closest_to_area"
  | "who_near_area"
  | "not_updated"
  | "currently_moving";

export interface LocationQueryResult {
  ok: boolean;
  message: string;
  error?: string;
}

const GULBERG_COORDS = { lat: 31.5204, lng: 74.3587 };
const DHA_COORDS = { lat: 31.475, lng: 74.406 };
const TOWNSHIP_COORDS = { lat: 31.468, lng: 74.307 };
const JOHAR_TOWN_COORDS = { lat: 31.428, lng: 74.279 };
const IQBAL_TOWN_COORDS = { lat: 31.504, lng: 74.246 };

function getAreaCoords(areaName: string): { lat: number; lng: number } | null {
  const lower = areaName.toLowerCase();
  if (lower.includes("gulberg")) return GULBERG_COORDS;
  if (lower.includes("dha")) return DHA_COORDS;
  if (lower.includes("township")) return TOWNSHIP_COORDS;
  if (lower.includes("johar")) return JOHAR_TOWN_COORDS;
  if (lower.includes("iqbal")) return IQBAL_TOWN_COORDS;
  return null;
}

function calculateDistanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function processLocationQuery(
  queryType: LocationQueryIntent | null,
  employeeName: string | null,
  areaName: string | null,
  locations: CurrentLocationView[]
): LocationQueryResult {
  switch (queryType) {
    case "where_is_employee":
      return handleWhereIsEmployee(employeeName, locations);
    case "all_locations":
      return handleAllLocations(locations);
    case "closest_to_area":
      return handleClosestToArea(areaName, locations);
    case "who_near_area":
      return handleWhoNearArea(areaName, locations);
    case "not_updated":
      return handleNotUpdated(locations);
    case "currently_moving":
      return handleCurrentlyMoving(locations);
    default:
      return handleLocationSummary(locations);
  }
}

function handleWhereIsEmployee(employeeName: string | null, locations: CurrentLocationView[]): LocationQueryResult {
  if (!employeeName) {
    return { ok: false, message: "Please tell me which employee you want to locate.", error: "MISSING_NAME" };
  }
  const lower = employeeName.toLowerCase();
  const employee = locations.find((l) => l.employeeName.toLowerCase().includes(lower));
  if (!employee || !employee.hasLocation) {
    if (locations.some((l) => l.employeeName.toLowerCase().includes(lower))) {
      return { ok: true, message: `${employeeName} is on duty but no recent location data is available.` };
    }
    return { ok: false, message: `I could not find an active employee named ${employeeName}.`, error: "NOT_FOUND" };
  }
  const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${employee.latitude},${employee.longitude}`;
  const age = employee.lastUpdateAge < 60000 ? "less than a minute ago" : `${Math.round(employee.lastUpdateAge / 60000)} minutes ago`;
  const status = employee.isOnDuty ? "on duty" : "off duty";
  const speedInfo = employee.speed && employee.speed > 1 ? ` Moving at ${Math.round(employee.speed * 3.6)} km/h.` : "";
  return {
    ok: true,
    message: `${employee.employeeName} is at a location near ${employee.latitude.toFixed(4)}, ${employee.longitude.toFixed(4)}. Last updated ${age}. Status: ${status}.${speedInfo} Open navigation: ${mapsUrl}`,
  };
}

function handleAllLocations(locations: CurrentLocationView[]): LocationQueryResult {
  const withLocation = locations.filter((l) => l.hasLocation && l.isOnDuty);
  if (withLocation.length === 0) {
    return { ok: true, message: "No employee locations available right now." };
  }
  const items = withLocation.slice(0, 5).map((l) => {
    const age = l.lastUpdateAge < 60000 ? "now" : `${Math.round(l.lastUpdateAge / 60000)}m ago`;
    const speed = l.speed && l.speed > 1 ? ` moving` : "";
    return `${l.employeeName} at ${l.latitude.toFixed(4)}, ${l.longitude.toFixed(4)} (${age})${speed}`;
  });
  const extra = withLocation.length > 5 ? ` And ${withLocation.length - 5} more.` : "";
  return { ok: true, message: `Employee locations: ${items.join(". ")}.${extra}` };
}

function handleClosestToArea(areaName: string | null, locations: CurrentLocationView[]): LocationQueryResult {
  if (!areaName) {
    return { ok: false, message: "Please tell me the area to check.", error: "MISSING_AREA" };
  }
  const target = getAreaCoords(areaName);
  if (!target) {
    return { ok: true, message: `I don't have coordinates for ${areaName}. Please specify Gulberg, DHA, Township, Johar Town, or Iqbal Town.` };
  }
  const withLocation = locations.filter((l) => l.hasLocation && l.isOnDuty);
  if (withLocation.length === 0) {
    return { ok: true, message: "No employees with location data available." };
  }
  let closest = withLocation[0];
  let minDist = calculateDistanceMeters(target.lat, target.lng, closest.latitude, closest.longitude);
  for (let i = 1; i < withLocation.length; i++) {
    const dist = calculateDistanceMeters(target.lat, target.lng, withLocation[i].latitude, withLocation[i].longitude);
    if (dist < minDist) {
      minDist = dist;
      closest = withLocation[i];
    }
  }
  const distKm = (minDist / 1000).toFixed(1);
  return {
    ok: true,
    message: `${closest.employeeName} is closest to ${areaName}, approximately ${distKm} km away.`,
  };
}

function handleWhoNearArea(areaName: string | null, locations: CurrentLocationView[]): LocationQueryResult {
  if (!areaName) {
    return { ok: false, message: "Please tell me the area to check.", error: "MISSING_AREA" };
  }
  const target = getAreaCoords(areaName);
  if (!target) {
    return { ok: true, message: `I don't have coordinates for ${areaName}.` };
  }
  const withLocation = locations.filter((l) => l.hasLocation && l.isOnDuty);
  const near = withLocation.filter((l) => calculateDistanceMeters(target.lat, target.lng, l.latitude, l.longitude) < 2000);
  if (near.length === 0) {
    return { ok: true, message: `No employees are currently near ${areaName}.` };
  }
  const items = near.map((l) => `${l.employeeName} (${Math.round(calculateDistanceMeters(target.lat, target.lng, l.latitude, l.longitude))}m away)`);
  return { ok: true, message: `Employees near ${areaName}: ${items.join(", ")}.` };
}

function handleNotUpdated(locations: CurrentLocationView[]): LocationQueryResult {
  const stale = locations.filter((l) => l.isOnDuty && (!l.hasLocation || l.lastUpdateAge > 5 * 60 * 1000));
  if (stale.length === 0) {
    return { ok: true, message: "All on-duty employees have recent location updates." };
  }
  const items = stale.slice(0, 5).map((l) => {
    const age = l.hasLocation ? `${Math.round(l.lastUpdateAge / 60000)} minutes ago` : "never";
    return `${l.employeeName} (last update: ${age})`;
  });
  const extra = stale.length > 5 ? ` And ${stale.length - 5} more.` : "";
  return { ok: true, message: `Employees without recent location updates: ${items.join(". ")}.${extra}` };
}

function handleCurrentlyMoving(locations: CurrentLocationView[]): LocationQueryResult {
  const moving = locations.filter((l) => l.hasLocation && l.isOnDuty && l.speed && l.speed > 1);
  if (moving.length === 0) {
    return { ok: true, message: "No employees are currently moving." };
  }
  const items = moving.map((l) => `${l.employeeName} at ${Math.round((l.speed ?? 0) * 3.6)} km/h`);
  return { ok: true, message: `Employees currently moving: ${items.join(", ")}.` };
}

function handleLocationSummary(locations: CurrentLocationView[]): LocationQueryResult {
  const total = locations.length;
  const onDuty = locations.filter((l) => l.isOnDuty).length;
  const withLocation = locations.filter((l) => l.hasLocation).length;
  const moving = locations.filter((l) => l.speed !== null && l.speed !== undefined && l.speed > 1).length;
  return {
    ok: true,
    message: `Location summary: ${total} employees total, ${onDuty} on duty, ${withLocation} with recent location, ${moving} currently moving.`,
  };
}
