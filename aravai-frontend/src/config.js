// PC IPv4 address (same Wi-Fi as the phone)
export const API_URL = 'http://10.0.250.146:4000/api/v1';

// Where the app itself is opened. Must be the same as APP_URL in the backend .env (machine QR links use it).
export const APP_URL = 'http://10.0.250.146:8081';

// true  = every weighed material needs a verified weighing machine photo before "Save Batch" unlocks
// false = the photo is optional
// Keep this the same as REQUIRE_WEIGHT_PHOTO in the backend .env (backend default is now true as well).
export const REQUIRE_WEIGHT_PHOTO = true;

// Temporarily OFF: QR scanning of the weighing machine and matching the machine shown in the photo.
// Weight verification (photo OCR vs the manually entered weight) works without it. Set to true to bring the QR checks back.
export const MACHINE_QR_ENABLED = true;