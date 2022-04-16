import util from 'util';
import only from 'only';
import { IncomingMessage, ServerResponse } from 'http';
import assert from 'assert';
import statuses from 'statuses';
import vary from 'vary';
import { Stream } from 'stream';
import encodeUrl from 'encodeurl';
import destroy from 'destroy';
import onFinish from 'on-finished';
import escape from 'escape-html';
import { extname } from 'path';
import contentDisposition from 'content-disposition';
import getType from 'cache-content-type';
import typeis from 'type-is';

export default class Response {
  ctx;
  req: IncomingMessage;
  res: ServerResponse;
  _body: String | Buffer | Object | Stream;
  _explicitStatus: boolean;
  _explicitNullBody: boolean;

  constructor() {
    if (util.inspect.custom) {
      this[util.inspect.custom] = this.inspect;
    }
  }

  get socket() {
    return this.res.socket;
  }

  get header() {
    const { res } = this
    return typeof res.getHeaders === 'function'
      ? res.getHeaders()
      // @ts-ignore
      : res._headers || {} // Node < 7.7
  }

  get headers() {
    return this.header
  }

  get status() {
    return this.res.statusCode
  }

  set status(code: number) {
    if (this.headerSent) return

    assert(Number.isInteger(code), 'status code must be a number')
    assert(code >= 100 && code <= 999, `invalid status code: ${code}`)
    this._explicitStatus = true
    this.res.statusCode = code
    if (this.req.httpVersionMajor < 2) this.res.statusMessage = statuses[code]
    if (this.body && statuses.empty[code]) this.body = null
  }

  get message() {
    return this.res.statusMessage || statuses[this.status]
  }

  set message(msg: string) {
    this.res.statusMessage = msg
  }

  get body() {
    return this._body;
  }

  set body(val: String | Buffer | Object | Stream) {
    const original = this._body
    this._body = val

    // no content
    if (val == null) {
      if (!statuses.empty[this.status]) {
        if (this.type === 'application/json') {
          this._body = 'null';
          return
        }
        this.status = 204
      }
      if (val === null) this._explicitNullBody = true
      this.remove('Content-Type')
      this.remove('Content-Length')
      this.remove('Transfer-Encoding')
      return
    }

    // set the status
    if (!this._explicitStatus) this.status = 200

    // set the content-type only if not yet set
    const setType = !this.has('Content-Type')

    // string
    if (typeof val === 'string') {
      if (setType) this.type = /^\s*</.test(val) ? 'html' : 'text'
      this.length = Buffer.byteLength(val)
      return
    }

    // buffer
    if (Buffer.isBuffer(val)) {
      if (setType) this.type = 'bin'
      this.length = val.length
      return
    }

    // stream
    if (val instanceof Stream) {
      onFinish(this.res, destroy.bind(null, val))
      if (original !== val) {
        val.once('error', err => this.ctx.onerror(err))
        // overwriting
        if (original != null) this.remove('Content-Length')
      }

      if (setType) this.type = 'bin'
      return
    }

    // json
    this.remove('Content-Length')
    this.type = 'json'
  }

  set length(n: number) {
    if (!this.has('Transfer-Encoding')) {
      this.set('Content-Length', n)
    }
  }

  get length() {
    if (this.has('Content-Length')) {
      return parseInt(this.get('Content-Length') as string, 10) || 0
    }

    const { body } = this
    if (!body || body instanceof Stream) return undefined
    if (typeof body === 'string') return Buffer.byteLength(body)
    if (Buffer.isBuffer(body)) return body.length
    return Buffer.byteLength(JSON.stringify(body))
  }

  get headerSent() {
    return this.res.headersSent
  }

  vary(field: string) {
    if (this.headerSent) return

    vary(this.res, field)
  }

  redirect(url: string, alt?: string) {
    // location
    if (url === 'back') url = this.ctx.get('Referrer') || alt || '/'
    this.set('Location', encodeUrl(url))

    // status
    if (!statuses.redirect[this.status]) this.status = 302

    // html
    if (this.ctx.accepts('html')) {
      url = escape(url)
      this.type = 'text/html; charset=utf-8'
      this.body = `Redirecting to <a href="${url}">${url}</a>.`
      return
    }

    // text
    this.type = 'text/plain; charset=utf-8'
    this.body = `Redirecting to ${url}.`
  }

  attachment(filename: string, options?) {
    if (filename) this.type = extname(filename)
    this.set('Content-Disposition', contentDisposition(filename, options))
  }

  set type(type: string) {
    type = getType(type)
    if (type) {
      this.set('Content-Type', type)
    } else {
      this.remove('Content-Type')
    }
  }

  set lastModified(val: string | Date) {
    if (typeof val === 'string') val = new Date(val)
    this.set('Last-Modified', val.toUTCString())
  }

  get lastModified() {
    const date = this.get('last-modified') as string
    if (date) return new Date(date)
  }

  set etag(val: string) {
    if (!/^(W\/)?"/.test(val)) val = `"${val}"`
    this.set('ETag', val)
  }

  get etag() {
    return this.get('ETag') as string
  }

  get type() {
    const type = this.get('Content-Type') as string
    if (!type) return ''
    return type.split(';', 1)[0]
  }

  is(type: string | string[], ...types: string[]): string | false {
    return typeis(this.type, type, ...types)
  }

  get(field: string) {
    return this.res.getHeader(field)
  }

  has(field: string) {
    return typeof this.res.hasHeader === 'function'
      ? this.res.hasHeader(field)
      // Node < 7.7
      : field.toLowerCase() in this.headers;
  }

  set(field: string | object, val: string | number | string[]) {
    if (this.headerSent) return

    if (arguments.length === 2) {
      if (Array.isArray(val)) val = val.map(v => typeof v === 'string' ? v : String(v))
      else if (typeof val !== 'string') val = String(val)
      this.res.setHeader(field as string, val)
    } else {
      for (const key in field as object) {
        this.set(key, field[key])
      }
    }
  }

  append(field: string, val: string | string[]) {
    const prev = this.get(field) as string

    if (prev) {
      val = Array.isArray(prev)
        ? prev.concat(val)
        : [prev].concat(val)
    }

    return this.set(field, val)
  }

  remove(field: string) {
    if (this.headerSent) return

    this.res.removeHeader(field)
  }

  get writable() {
    // can't write any more after response finished
    // response.writableEnded is available since Node > 12.9
    // https://nodejs.org/api/http.html#http_response_writableended
    // response.finished is undocumented feature of previous Node versions
    // https://stackoverflow.com/questions/16254385/undocumented-response-finished-in-node-js
    if (this.res.writableEnded || this.res.finished) return false

    const socket = this.res.socket
    // There are already pending outgoing res, but still writable
    // https://github.com/nodejs/node/blob/v4.4.7/lib/_http_server.js#L486
    if (!socket) return true
    return socket.writable
  }

  inspect () {
    if (!this.res) return
    const o = this.toJSON()
    o.body = this.body
    return o
  }

  toJSON() {
    return only(this, [
      'status',
      'message',
      'header'
    ]);
  }

  flushHeaders () {
    this.res.flushHeaders()
  }
}