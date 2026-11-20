export function sendSuccess(
  res,
  statusCode,
  message,
  data,
  extra = {},
) {
  return res.status(statusCode).json({
    success: true,
    message,
    ...extra,
    ...(data !== undefined ? { data } : {}),
  });
}

export function sendError(
  res,
  statusCode,
  message,
  extra = {},
) {
  return res.status(statusCode).json({
    success: false,
    message,
    ...extra,
  });
}