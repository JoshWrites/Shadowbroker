import { useCallback, useState, useEffect } from "react";
import { API_BASE } from "@/lib/api";
import type { RegionDossier, SelectedEntity } from "@/types/dashboard";

export function useRegionDossier(
  selectedEntity: SelectedEntity | null,
  setSelectedEntity: (entity: SelectedEntity | null) => void
) {
  const [regionDossier, setRegionDossier] = useState<RegionDossier | null>(null);
  const [regionDossierLoading, setRegionDossierLoading] = useState(false);

  const handleMapRightClick = useCallback(async (coords: { lat: number; lng: number }) => {
    setSelectedEntity({ type: 'region_dossier', id: `${coords.lat.toFixed(4)}_${coords.lng.toFixed(4)}`, extra: coords });
    setRegionDossierLoading(true);
    setRegionDossier(null);
    try {
      const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${coords.lat}&longitude=${coords.lng}`
        + `&hourly=temperature_2m,relative_humidity_2m,dew_point_2m,apparent_temperature,precipitation,rain,showers,snowfall,snow_depth,weather_code,cloud_cover,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m,visibility,uv_index`
        + `&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max,weather_code,sunrise,sunset`
        + `&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,cloud_cover,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m,precipitation,uv_index,is_day`
        + `&timezone=auto&past_days=10&forecast_days=7`;
      const [dossierRes, sentinelRes, weatherRes] = await Promise.allSettled([
        fetch(`${API_BASE}/api/region-dossier?lat=${coords.lat}&lng=${coords.lng}`),
        fetch(`${API_BASE}/api/sentinel2/search?lat=${coords.lat}&lng=${coords.lng}`),
        fetch(weatherUrl),
      ]);
      let dossierData: Record<string, unknown> = {};
      if (dossierRes.status === 'fulfilled' && dossierRes.value.ok) {
        dossierData = await dossierRes.value.json();
      }
      let sentinelData = null;
      if (sentinelRes.status === 'fulfilled' && sentinelRes.value.ok) {
        sentinelData = await sentinelRes.value.json();
      }
      let weatherData = null;
      if (weatherRes.status === 'fulfilled' && weatherRes.value.ok) {
        weatherData = await weatherRes.value.json();
      }
      setRegionDossier({ lat: coords.lat, lng: coords.lng, ...dossierData, sentinel2: sentinelData, weather: weatherData });
    } catch (e) {
      console.error("Failed to fetch region dossier", e);
    } finally {
      setRegionDossierLoading(false);
    }
  }, [setSelectedEntity]);

  // Clear dossier when selecting a different entity type
  useEffect(() => {
    if (selectedEntity?.type !== 'region_dossier') {
      setRegionDossier(null);
      setRegionDossierLoading(false);
    }
  }, [selectedEntity]);

  return { regionDossier, regionDossierLoading, handleMapRightClick };
}
