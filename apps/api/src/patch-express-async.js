import express from 'express';

const PATCH_MARK = Symbol.for('languagebot.expressAsyncPatched');
const HANDLER_MARK = Symbol.for('languagebot.expressAsyncWrapped');
const routerPrototype = Object.getPrototypeOf(express.Router());
const applicationPrototype = express.application;

function wrapHandler(handler) {
  if (typeof handler !== 'function' || handler[HANDLER_MARK]) {
    return handler;
  }
  if (handler.length === 4) {
    return handler;
  }

  function wrappedHandler(req, res, next) {
    try {
      const result = handler(req, res, next);
      if (result && typeof result.then === 'function') {
        result.catch(next);
      }
      return result;
    } catch (error) {
      return next(error);
    }
  }

  wrappedHandler[HANDLER_MARK] = true;
  return wrappedHandler;
}

function wrapHandlers(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => wrapHandlers(entry));
  }
  return wrapHandler(value);
}

function patchMethod(target, method) {
  const original = target[method];
  if (typeof original !== 'function') return;

  target[method] = function patchedRouterMethod(...args) {
    return original.call(this, ...args.map((arg) => wrapHandlers(arg)));
  };
}

if (!routerPrototype[PATCH_MARK]) {
  for (const method of ['use', 'all', 'get', 'post', 'put', 'patch', 'delete', 'options', 'head']) {
    patchMethod(routerPrototype, method);
    patchMethod(applicationPrototype, method);
  }
  routerPrototype[PATCH_MARK] = true;
  applicationPrototype[PATCH_MARK] = true;
}
