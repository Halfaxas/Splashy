use serde::{Deserialize, Serialize};

// ===== Unsplash API response types =====

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ApiUrls {
    pub raw: Option<String>,
    pub full: Option<String>,
    pub regular: Option<String>,
    pub small: Option<String>,
    pub thumb: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ApiLinks {
    pub download_location: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ApiProfileImage {
    pub small: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ApiUser {
    pub username: String,
    pub name: String,
    pub bio: Option<String>,
    pub profile_image: Option<ApiProfileImage>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ApiPhoto {
    pub id: String,
    pub slug: Option<String>,
    pub urls: ApiUrls,
    pub links: ApiLinks,
    pub user: ApiUser,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ApiRelatedPhotosResult {
    pub total: u32,
    pub results: Vec<ApiPhoto>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ApiCollection {
    pub id: String,
    pub title: String,
    pub description: Option<String>,
    pub total_photos: u32,
    pub cover_photo: Option<ApiPhoto>,
    pub user: Option<ApiUser>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ApiUserProfile {
    pub username: String,
    pub name: String,
    pub bio: Option<String>,
    pub total_photos: u32,
    pub profile_image: Option<ApiProfileImage>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ApiTopic {
    pub id: String,
    pub slug: String,
    pub title: String,
    pub total_photos: u32,
    pub cover_photo: Option<ApiPhoto>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ApiStatPoint {
    pub date: String,
    pub value: u64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ApiStatHistorical {
    pub change: i64,
    pub values: Vec<ApiStatPoint>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ApiStatGroup {
    pub total: u64,
    pub historical: ApiStatHistorical,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ApiPhotoStatistics {
    pub id: String,
    pub downloads: ApiStatGroup,
    pub views: ApiStatGroup,
    pub likes: ApiStatGroup,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ApiSearchPhotosResult {
    pub total: u64,
    pub total_pages: u64,
    pub results: Vec<ApiPhoto>,
}

// ===== On-disk storage types =====

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CollectionMeta {
    pub id: String,
    pub title: String,
    pub description: Option<String>,
    pub total_photos: u32,
    pub cover_photo_id: Option<String>,
    pub cover_url: Option<String>,
    #[serde(default)]
    pub etag: Option<String>,
    #[serde(default)]
    pub last_checked_iso: Option<String>,
    #[serde(default)]
    pub author_name: Option<String>,
    #[serde(default)]
    pub author_username: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserProfile {
    pub username: String,
    pub name: String,
    pub bio: Option<String>,
    pub total_photos: u32,
    /// Small avatar URL (cached so avatar refresh doesn't need an API call)
    #[serde(default)]
    pub avatar_url: Option<String>,
    /// IDs of the 10 latest photos currently cached as previews
    #[serde(default)]
    pub photo_preview_ids: Vec<String>,
    #[serde(default)]
    pub last_checked_iso: Option<String>,
    #[serde(default)]
    pub avatar_last_refreshed_iso: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TopicMeta {
    pub id: String,
    pub slug: String,
    pub title: String,
    pub total_photos: u32,
    pub cover_photo_id: Option<String>,
    pub cover_url: Option<String>,
    /// Which query param to use when fetching random photos: "topics" or "collections".
    /// Determined once on first import by probing the Unsplash API.
    #[serde(default)]
    pub photo_param: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WallpaperMeta {
    pub photo_id: String,
    pub source_type: String,
    pub source_value: Option<String>,
    pub author_username: String,
    pub author_name: String,
    pub unsplash_url: String,
    pub downloaded_iso: String,
    /// Time-of-day group active when this wallpaper was selected
    /// ("morning" | "day" | "afternoon" | "night"). None for random fallback.
    #[serde(default)]
    pub time_group: Option<String>,
}

// ===== Command return types (serialized to frontend) =====

#[derive(Debug, Serialize)]
pub struct CollectionSummary {
    pub id: String,
    pub title: String,
    pub description: Option<String>,
    pub count: u32,
    pub cover_url: Option<String>,
    pub author_name: Option<String>,
    pub author_username: Option<String>,
    pub enabled: bool,
}

#[derive(Debug, Serialize)]
pub struct UserSummary {
    pub username: String,
    pub name: String,
    pub bio: Option<String>,
    pub total_photos: u32,
    pub avatar_path: Option<String>,
    pub enabled: bool,
}

#[derive(Debug, Serialize)]
pub struct TopicWithEnabled {
    pub id: String,
    pub slug: String,
    pub title: String,
    pub total_photos: u32,
    pub cover_url: Option<String>,
    pub enabled: bool,
}

#[derive(Debug, Serialize)]
pub struct CurrentWallpaperInfo {
    pub path: String,
    pub author_name: String,
    pub author_username: String,
    pub unsplash_url: String,
    pub photo_id: String,
}

#[derive(Debug, Serialize)]
pub struct AdjacentWallpapers {
    pub previous: Option<CurrentWallpaperInfo>,
    pub next: Option<CurrentWallpaperInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RelatedSourceMeta {
    pub photo_id: String,
    pub slug: String,
    pub author_name: String,
    pub author_username: String,
    pub unsplash_url: String,
    pub added_iso: String,
}

#[derive(Debug, Serialize)]
pub struct RelatedSourceSummary {
    pub photo_id: String,
    pub slug: String,
    pub author_name: String,
    pub author_username: String,
    pub unsplash_url: String,
    pub cover_url: Option<String>,
    pub enabled: bool,
}
