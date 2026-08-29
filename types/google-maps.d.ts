/**
 * Minimal ambient surface of the Google Maps JavaScript API used by the
 * appearance map frame. Deliberately hand-written instead of pulling
 * `@types/google.maps`: the frame touches exactly these members and nothing
 * else, so a dependency-free declaration keeps the surface reviewable.
 */
declare namespace google.maps {
  interface LatLngLiteral {
    lat: number;
    lng: number;
  }

  class LatLng {
    constructor(lat: number, lng: number);
    lat(): number;
    lng(): number;
  }

  class LatLngBounds {
    constructor();
  }

  interface MapMouseEvent {
    latLng: LatLng | null;
  }

  /** `google.maps.ColorScheme` — the map's fixed appearance, supplied at initialisation. */
  type ColorScheme = "DARK" | "LIGHT" | "FOLLOW_SYSTEM";

  interface MapOptions {
    center?: LatLngLiteral;
    zoom?: number;
    mapTypeControl?: boolean;
    streetViewControl?: boolean;
    fullscreenControl?: boolean;
    clickableIcons?: boolean;
    gestureHandling?: string;
    colorScheme?: ColorScheme;
  }

  class Map {
    constructor(element: HTMLElement, options?: MapOptions);
    setCenter(center: LatLngLiteral): void;
    fitBounds(bounds: LatLngBounds, padding?: number): void;
    addListener(eventName: string, handler: (event: MapMouseEvent) => void): MapsEventListener;
  }

  interface MarkerOptions {
    map?: Map;
    position?: LatLngLiteral;
    draggable?: boolean;
    title?: string;
  }

  class Marker {
    constructor(options?: MarkerOptions);
    setPosition(position: LatLngLiteral): void;
    getPosition(): LatLng | null | undefined;
    addListener(eventName: string, handler: () => void): MapsEventListener;
  }

  interface CircleOptions {
    map?: Map;
    center?: LatLngLiteral;
    radius?: number;
    strokeColor?: string;
    strokeOpacity?: number;
    strokeWeight?: number;
    fillColor?: string;
    fillOpacity?: number;
    clickable?: boolean;
  }

  class Circle {
    constructor(options?: CircleOptions);
    setCenter(center: LatLngLiteral): void;
    setRadius(radius: number): void;
    getBounds(): LatLngBounds | null;
  }

  interface MapsEventListener {
    remove(): void;
  }
}
