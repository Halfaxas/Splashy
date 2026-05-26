export type View = "home" | "collections" | "users" | "topics" | "queries" | "colors" | "related" | "settings";

export interface AppSettings {
  quality: string;
  orientation: string;
  wallpaper_cron: string;
  api_key: string | null;
}

export interface CollectionSummary {
  id: string;
  title: string;
  description: string | null;
  count: number;
  cover_url: string | null;
  author_name: string | null;
  author_username: string | null;
  enabled: boolean;
}

export interface UserSummary {
  username: string;
  name: string;
  bio: string | null;
  total_photos: number;
  avatar_path: string | null;
  enabled: boolean;
}

export interface TopicWithEnabled {
  id: string;
  slug: string;
  title: string;
  total_photos: number;
  cover_url: string | null;
  enabled: boolean;
}

export interface ColorSource {
  color: string;
  enabled: boolean;
}

export interface QuerySummary {
  id: string;
  value: string;
  enabled: boolean;
  weight: number;
}

export interface RelatedSourceSummary {
  photo_id: string;
  slug: string;
  author_name: string;
  author_username: string;
  unsplash_url: string;
  cover_url: string | null;
  enabled: boolean;
}

export interface CurrentWallpaperInfo {
  path: string;
  author_name: string;
  author_username: string;
  unsplash_url: string;
  photo_id: string;
}

export interface AdjacentWallpapers {
  previous: CurrentWallpaperInfo | null;
  next: CurrentWallpaperInfo | null;
}

export interface TimeGroup {
  id: string;
  label: string;
  start_hour: number;
  end_hour: number;
  target_ids: string[];
}
