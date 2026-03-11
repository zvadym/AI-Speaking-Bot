export function createAppError(code, statusCode, detail = code, extras = {}) {
  const error = new Error(detail || code);
  error.code = code;
  error.statusCode = statusCode;
  error.detail = detail || code;
  Object.assign(error, extras);
  return error;
}

export function httpError(status, error, detail, extra = {}) {
  const err = new Error(detail || error);
  err.status = status;
  err.payload = {
    error,
    ...(detail ? { detail } : {}),
    ...extra
  };
  return err;
}

export function isHttpError(error) {
  return Boolean(error?.status && error?.payload);
}

export function stripeErrorPayload(err, fallback = 'stripe_error') {
  const message = (err?.raw?.message || err?.message || fallback).toString();
  const code = (err?.code || fallback).toString();
  const payload = {
    error: fallback,
    detail: message,
    code
  };
  if (err?.param) payload.param = String(err.param);
  return payload;
}

export function billingRouteErrorResponse(res, err, fallbackStatus = 400) {
  if (isHttpError(err)) {
    return res.status(err.status).json(err.payload);
  }
  return res.status(fallbackStatus).json(stripeErrorPayload(err));
}
