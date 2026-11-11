module.exports = (err, req, res, next) => {
  let status = err.status || 500;
  let message = err.message;
  if (err.code === 'ER_DUP_ENTRY') { status = 409; message = 'Duplicate entry: record already exists'; }
  if (err.code === 'ER_CHECK_CONSTRAINT_VIOLATED') { status = 400; message = 'Operation rejected: stock cannot go negative'; }
  if (status === 500) { console.error(err); message = 'Internal server error'; }
  res.status(status).json({ success: false, message });
};
