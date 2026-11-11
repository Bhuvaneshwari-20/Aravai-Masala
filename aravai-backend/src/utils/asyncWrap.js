// Wraps a controller so success -> { success:true, data } and errors go to errorHandler
module.exports = (fn, status = 200) => async (req, res, next) => {
  try {
    res.status(status).json({ success: true, data: await fn(req) });
  } catch (e) {
    next(e);
  }
};
