import forEach from 'lodash/forEach'
import set from 'lodash/set'
import qs from 'qs'
import edata, {
  EdataBaseClass
} from 'edata'
import isPOJO from 'is-plain-obj'
import pathToRegexp from 'path-to-regexp'

import 'url-polyfill'
import 'abortcontroller-polyfill/dist/abortcontroller-polyfill-only'
import {
  fetch
} from 'whatwg-fetch'

import {
  parse as parseResponse
} from './fetch-parse'
import MediaType from 'medium-type'
const WILDCARD_PARSER = [
  [new MediaType("*/*"), null]
]

export function noop() {}

export function isFunction(e) {
  return typeof e === 'function'
}

export function joinPath(prev, url) {
  prev = prev || ''
  if (url[0] != '/') url = '/' + url
  if (prev[prev.length - 1] == '/') prev = prev.slice(0, -1)
  return prev + url
}

// use native browser implementation if it supports aborting
const abortableFetch = 'signal' in new Request('') ? window.fetch : fetch

const defaultHeaders = {
  'Content-Type': 'application/json; charset=utf-8'
}

const defaultReplaceParams = {
  encode: noop
}

function replaceParams(url, params, options) {
  return pathToRegexp.compile(url)(params || {}, options)
}

export function parseUrlPart(url) {
  const [part1, hash = ''] = url.split('#')
  const [part2, query = ''] = part1.split('?')
  const [, protocol = '', host = '', pathname] = part2.match(/^(\w+:)?(\/\/[\w\d\-\.:]+)?(.*)$/)
  return {
    protocol,
    host,
    pathname,
    query,
    hash,
  }
}
// console.log(parseUrlPart('http://10.0.2.2:8081/playground/index.bundle?platform=android&dev=true&minify=false'))

export function joinUrlPart(obj) {
  const {
    protocol = '', host = '', pathname = '', query = '', hash = ''
  } = obj
  return protocol + host + pathname + (query ? '?' + query : '') + (hash ? '#' + hash : '')
}

function defaultGetResponse(response) {
  return parseResponse(WILDCARD_PARSER, response)
}

function identity(res) {
  return res
}

function debugErrorHandler(err) {
  if (err.name === 'AbortError') {
    console.log('request aborted')
  }
  console.log(err)
}

function unwrapEData(edata) {
  while (edata instanceof EdataBaseClass) {
    edata = edata.value
  }
  return edata
}

export const globalAjaxSetting = {
  headers: defaultHeaders,
  beforeRequest: identity,
  getResponse: defaultGetResponse,
  afterResponse: identity,
  errorHandler: null
}

export function makeAPI(model, res) {
  const namespace = model.name || model.displayName
  if (!namespace) {
    throw `model should have .name or .displayName: ${JSON.stringify(model)}`
  }
  return data => {
    data = data || {}
    data._store = data._store || {}
    data._actions = data._actions || {}
    data._api = data._api || {}
    data._store[namespace] = new EdataBaseClass({
      ...model.store,
      ...unwrapEData(data._store[namespace])
    })
    data._actions[namespace] = new EdataBaseClass({
      ...model.actions,
      ...unwrapEData(data._actions[namespace])
    })
    forEach(res, (value, key) => {
      set(data._api, [namespace, key], value)
    })
    const apis = data._api[namespace] || {}
    forEach(model.actions, (value, key) => {
      if (!(key in apis)) {
        set(data._api, [namespace, key], {})
      }
    })
    return data
  }
}

export function initModel(config, unwrapOptions) {
  return data => {
    const model = edata(data, {
      unwrapConfig: unwrapAPI(unwrapOptions),
      ...config
    })
    const {
      getAPIFromRoute
    } = getAPIFactoryFromModel(model)
    const apiProps = unwrapOptions.apiProps = getAPIFromRoute({
      api: ['*']
    })
    return {model, apiProps}
  }
}

export function getAPIFactoryFromModel(model) {
  const allAPI = Object.keys((model.get(['_api']) || {}).value || {})

  function expandAPINameItem(val) {
    let names = [val]
    if (val instanceof RegExp) {
      names = allAPI.filter(v => val.test(v))
    }
    if (val === '*') {
      names = allAPI
    }
    return names
  }

  function getAPIFromRoute({
    api = ['*']
  } = {}) {
    const props = {}
    // const apiObj = model.unwrap(['_api', '_global']) || {}
    // Object.keys(apiObj).forEach((key) => {
    //   props[key] = model.unwrap(['_api', '_global', key])
    // })
    // props.store = model.unwrap(['_store', '_global']) || {}

    api.forEach(val => {
      const names = expandAPINameItem(val)
      names.filter(Boolean).forEach(name => {
        const services = {}
        props[name] = services
        const apiObj = (model.get(['_api', name]) || {}).value || {}
        Object.keys(apiObj).forEach((key) => {
          services[key] = model.unwrap(['_api', name, key])
        })
        services.store = model.unwrap(['_store', name]) || {}
      })
    })
    return props
  }
  return {
    getAPIFromRoute
  }
}

export function constOrFunction(value) {
  return isFunction(value) ? value() : value
}

const REGEX_HTTP_PROTOCOL = /^(https?:)?\/\//i

const fakeDomain = 'http://0.0.0.0'
export function unwrapAPI(unwrapOptions = {}) {
  return packer => {
    if (!packer) return
    const {
      path,
      root
    } = packer
    const model = root
    const [prefix, name, service] = path
    if (prefix == '_api' && path.length === 3) {
      return {
        map: apiConfig => {
          return (query, options = {}) =>
            Promise.resolve(isFunction(apiConfig) ? apiConfig(packer) : apiConfig).then(apiConfig => {
              const {
                paramStyle,
                queryKey,
                mockKey,
                debug,
                apiProps
              } = unwrapOptions
              const ajaxSetting = {
                ...globalAjaxSetting,
                ...unwrapOptions.ajaxSetting
              }
              options = options || {}
              const actions = model.unwrap(['_actions', name]) || {}
              const store = model.unwrap(['_store', name]) || {}
              let actionService = actions[service]
              if (isFunction(actionService)) {
                actionService = {
                  callback: actionService
                }
              }
              const actionConfig = {
                ...ajaxSetting,
                ...actionService
              }
              let {
                exec,
                reducer,
                callback,
                timeout,
                headers,
                beforeRequest,
                getResponse,
                afterResponse,
                errorHandler,
              } = actionConfig
              let base = constOrFunction(actionConfig.base || actions.base)
              if (debug && !errorHandler) {
                errorHandler = debugErrorHandler
              }
              if (typeof exec === 'string') {
                exec = model.unwrap(['_api', name, exec], {
                  map: v => v,
                })
              }
              if (!exec) exec = {
                ...actionConfig,
                ...apiConfig
              }
              const success =
                (callback && callback.success) ||
                (reducer && reducer.success) ||
                callback ||
                reducer
              const start = (callback && callback.start) || (reducer && reducer.start)
              const fail = (callback && callback.fail) || (reducer && reducer.fail)
              const onSuccess = args => {
                if (success) {
                  let ret = success(store, args)
                  if (ret === false) {
                    return Promise.resolve(args)
                  }
                  return Promise.resolve(ret).then(ret => {
                    ret = Object.assign(store, ret)
                    model.set(['_store', name], model.of(store))
                    return ret
                  })
                } else {
                  return Promise.resolve(args)
                }
              }
              const onFail = (err = new Error()) => {
                err.isTimeout = isTimeout
                err.init = init
                clearTimeout(timeoutId)
                isFunction(errorHandler) && errorHandler(err)
                if (fail) {
                  const ret = fail(store, {
                    error: err,
                    props: apiProps,
                    model
                  })
                  if (ret === false) {
                    return Promise.reject(err)
                  }
                  return Promise.resolve(ret).then(ret => {
                    ret = Object.assign(store, ret)
                    model.set(['_store', name], model.of(store))
                    return ret
                  })
                } else {
                  return Promise.reject(err)
                }
              }
              if (!exec.url) {
                return onSuccess({
                  param: query,
                  model,
                  props: apiProps
                })
              }

              let mock = exec[mockKey]
              let param = exec[queryKey]
              if (isFunction(param)) {
                param = param()
              }

              const isBeateStyle = (actionConfig.paramStyle || paramStyle) == 'beatle'
              const method = String(exec.method || 'get').toUpperCase()
              const hasBody = /PUT|POST|PATCH/.test(method)
              const urlParam = isBeateStyle ? options.params : options
              const urlObj = parseUrlPart(exec.url)
              urlObj.pathname = replaceParams(
                urlObj.pathname,
                ...(isBeateStyle ? [options.params, options.options] : [options]),
              )
              let url = joinUrlPart(urlObj)
              if (base && !REGEX_HTTP_PROTOCOL.test(url)) {
                url = joinPath(base + '', url)
              }
              query = {
                ...param,
                ...query
              }
              let searchString = ''
              if (!hasBody && !isEmpty(query)) {
                searchString = qs.stringify(query)
              }
              if (options.query) {
                let addon = ''
                if (searchString) {
                  addon = '&'
                }
                searchString += addon + qs.stringify(options.query)
              }
              if (searchString) {
                url = url + '?' + searchString
              }
              const controller = new AbortController()
              timeout = Number(constOrFunction(exec.timeout || timeout))
              let isTimeout = false
              let timeoutId = -1
              let timeoutPromise = new Promise((resolve, reject) => {
                if (timeout > 0) {
                  timeoutId = setTimeout(() => {
                    isTimeout = true
                    if (mock) {
                      const abortError = new Error('Aborted due to timeout')
                      abortError.name = 'AbortError'
                      reject(abortError)
                    } else {
                      controller.abort()
                    }
                  }, timeout)
                } else {
                  resolve()
                }
              })
              let init = {
                method,
                signal: controller.signal,
                ...exec,
                headers: {
                  ...constOrFunction(window.ajaxHeader),
                  ...constOrFunction(headers),
                  ...constOrFunction(exec.headers),
                },
                body: hasBody ? JSON.stringify(query) : undefined,
                ...options,
                url,
              }
              beforeRequest(init)
              url = init.url
              let startPromise
              if (start) {
                startPromise = start(store, init)
              }

              return Promise.resolve(startPromise)
                .then(startStore => {
                  if (startStore != null) {
                    Object.assign(store, startStore)
                    model.set(['_store', name], model.of(store))
                  }
                  let promise = mock ?
                    Promise.resolve(
                      isFunction(mock) ?
                      mock() :
                      mock instanceof Response ?
                      mock :
                      new Response(
                        isPOJO(mock) || Array.isArray(mock) ? JSON.stringify(mock) : mock,
                      ),
                    ) :
                    abortableFetch(url, init)
                  // console.error(url, init)
                  return Promise.race([timeoutPromise, promise])
                    .then(() => {
                      clearTimeout(timeoutId)
                      return promise
                    })
                    .then(getResponse)
                    .then(res => {
                      afterResponse(res)
                      return onSuccess({
                        props: apiProps,
                        model,
                        response: res,
                        body: res.body,
                        urlParam,
                        param: query,
                        headerParam: init.headers,
                      }).then(() => {
                        return res
                      })
                    })
                    .catch(onFail)
                })
                .catch(onFail)
            })
        },
      }
    }
  }
}

/**
 * Checks if a value is empty.
 */
export function isEmpty(value) {
  if (Array.isArray(value)) {
    return value.length === 0
  } else if (typeof value === 'object') {
    if (value) {
      if (isIterable(value) && value.size !== undefined) {
        throw new Error('isEmpty() does not support iterable collections.')
      }
      for (const _ in value) {
        return false
      }
    }
    return true
  } else {
    return !value
  }
}

export function isIterable(value) {
  if (typeof Symbol === 'undefined') {
    return false
  }
  return value[Symbol.iterator]
}