import Application from './application';
import Request from './request';
import Response from './response';
import httpAssert from 'http-assert';
import createError from 'http-errors';
import Cookies from 'cookies';
import util from 'util';
import { IncomingMessage, ServerResponse } from 'http';

const COOKIES = Symbol('context#cookies')

export default class Context {
  app: Application;
  request: Request;
  response: Response;
  req: IncomingMessage;
  res: ServerResponse;
  originalUrl: string;

  assert: httpAssert;

  constructor() {
    if (util.inspect.custom) {
      this[util.inspect.custom] = this.inspect;
    }
  }

  inspect() {
    return this.toJSON()
  }

  toJSON() {
    return {
      request: this.request.toJSON(),
      response: this.response.toJSON(),
      app: this.app.toJSON(),
      originalUrl: this.originalUrl,
      req: '<original node req>',
      res: '<original node res>',
      socket: '<original node socket>'
    }
  }

  throw(...args) {
    throw createError(...args)
  }

  onerror(err) {

  }

  get cookies() {
    if (!this[COOKIES]) {
      this[COOKIES] = new Cookies(this.req, this.res, {
        keys: this.app.keys,
        secure: this.request.secure
      })
    }
    return this[COOKIES]
  }

  set cookies(_cookies) {
    this[COOKIES] = _cookies
  }
}