import { EventEmitter } from 'events';
const debug = require('debug')('koa:application')
import only from 'only';
import onFinished from 'on-finished';
import Stream from 'stream';
import http from 'http';
import util from 'util';
import statuses from 'statuses';
import compose from './compose';

interface IAppOptions {
  env?: string;
  keys?: string[];
  proxy?: boolean;
  subdomainOffset?: number;
  proxyIpHeader?: string;
  maxIpsCount?: number;
}

export default class Application extends EventEmitter {
  /**
   * Environment, default to 'development'
   */
  readonly env: string;
  /**
   * Signed cookie keys
   */
  readonly keys?: string[];
  /**
   * Trust proxy headers, default to false
   */
  readonly proxy: boolean;
  /**
   * Subdomain offset, default to 2
   */
  readonly subdomainOffset: number;
  /**
   * Proxy IP header, defaults to 'X-Forwarded-For'
   */
  readonly proxyIpHeader: string;
  /**
   * Max IPs read from proxy IP header, default to 0 (means infinity)
   */
  readonly maxIpsCount: number;

  readonly middleware: Function[];

  public silent: boolean = false;

  constructor(options: IAppOptions) {
    super();
    options = options || {}
    this.proxy = options.proxy || false
    this.subdomainOffset = options.subdomainOffset || 2
    this.proxyIpHeader = options.proxyIpHeader || 'X-Forwarded-For'
    this.maxIpsCount = options.maxIpsCount || 0
    this.env = options.env || process.env.NODE_ENV || 'development'
    if (options.keys) this.keys = options.keys
    this.middleware = []
    // TODO:
    if (util.inspect.custom) {
      this[util.inspect.custom] = this.inspect;
    }
  }

  listen(...args) {
    debug('listen');
    const server = http.createServer(this.callback());
    return server.listen(...args);
  }

  toJSON() {
    return only(this, [
      'subdomainOffset',
      'proxy',
      'env'
    ]);
  }

  inspect() {
    return this.toJSON();
  }

  use(fn: Function) {
    if (typeof fn !== 'function') throw new TypeError('middleware must be a function!');
    // @ts-ignore
    debug('use %s', fn._name || fn.name || '-');
    this.middleware.push(fn);
    return this;
  }

  callback() {
    const fn = compose(this.middleware);

    if (!this.listenerCount('error')) this.on('error', this.onerror);

    const handleRequest = (req, res) => {
      const ctx = this.createContext(req, res);
      return this.handleRequest(ctx, fn);
    }

    return handleRequest;
  }

  handleRequest(ctx, fnMiddleware) {
    const res = ctx.res;
    res.statusCode = 404;
    const onerror = err => ctx.onerror(err);
    const handleResponse = () => respond(ctx);
    onFinished(res, onerror);

    return fnMiddleware(ctx).then(handleResponse).catch(onerror);
  }

  createContext(req, res) {
    // TODO:
  }

  onerror(err) {
    // When dealing with cross-globals a normal `instanceof` check doesn't work properly.
    // See https://github.com/koajs/koa/issues/1466
    // We can probably remove it once jest fixes https://github.com/facebook/jest/issues/2549.
    const isNativeError =
      Object.prototype.toString.call(err) === '[object Error]' ||
      err instanceof Error
    if (!isNativeError) throw new TypeError(util.format('non-error thrown: %j', err))

    if (err.status === 404 || err.expose) return
    if (this.silent) return

    const msg = err.stack || err.toString()
    console.error(`\n${msg.replace(/^/gm, '  ')}\n`)
  }
}

function respond(ctx) {
  if (ctx.respond === false) return;

  if (!ctx.writable) return;

  const res = ctx.res;
  let body = ctx.body;
  const code = ctx.status;

  // ignore body
  if (statuses.empty[code]) {
    // strip headers
    ctx.body = null;
    return res.end();
  }

  if (ctx.method === 'HEAD') {
    if (!res.headersSent && !ctx.response.has('Content-Length')) {
      const { length } = ctx.response;

      if (Number.isInteger(length)) ctx.length = length;
    }
    return res.end();
  }

  // status body
  if (body == null) {
    if (ctx.response._explicitNullBody) {
      ctx.response.remove('Content-Type');
      ctx.response.remove('Transfer-Encoding');
      ctx.length = 0;
      return res.end();
    }
    if (ctx.req.httpVersionMajor >= 2) {
      body = String(code);
    } else {
      body = ctx.message || String(code);
    }
    if (!res.headersSent) {
      ctx.type = 'text';
      ctx.length = Buffer.byteLength(body);
    }
    return res.end(body);
  }

  // responses
  if (Buffer.isBuffer(body)) return res.end(body);
  if (typeof body === 'string') return res.end(body);
  if (body instanceof Stream) return body.pipe(res);

  // body: json
  body = JSON.stringify(body);
  if (!res.headersSent) {
    ctx.length = Buffer.byteLength(body);
  }
  res.end(body);
}