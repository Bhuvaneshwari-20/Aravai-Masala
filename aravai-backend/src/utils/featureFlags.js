// Feature switches read from .env.
//   MACHINE_QR_ENABLED=true   brings back QR scanning / QR token validation / machine identification for batching weight photos.
//                              Default (not set / anything else) = OFF: batching weight verification works from the photo weight alone and never
//                              uses machine_id or qr_value.
module.exports = {
  MACHINE_QR_ENABLED: String(process.env.MACHINE_QR_ENABLED || '').toLowerCase() === 'true',
};
