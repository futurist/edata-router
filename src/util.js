import forEach from 'lodash/forEach'
import set from 'lodash/set'
import qs from 'qs'
import edata, { EdataBaseClass } from 'edata'
import isPOJO from 'is-plain-obj'
import pathToRegexp from 'path-to-regexp'

import 'url-polyfill'
import 'abortcontroller-polyfill/dist/abortcontroller-polyfill-only'
import { fetch } from 'whatwg-fetch'

export function noop(){}
// use native browser implementation if it supports aborting
const abortableFetch = 'signal' in new Request('') ? window.fetch : fetch

const defaultHeaders = {
  'Content-Type': 'application/json; charset=utf-8'
}

export const globalAjaxSetting = {
  headers: defaultHeaders,
  checkStatus: defaultCheckStatus,
  beforeResponse: defaultBeforeResponse,
  afterResponse: defaultAfterResponse,
  errorHandler: defaultErrorHandler
}

const defaultReplaceParams = { encode: noop }
function replaceParams (url, params, options) {
  return pathToRegexp.compile(url)(params || {}, options)
}

function defaultCheckStatus (response) {
  if (
    (response.status >= 200 && response.status < 300) ||
    response.status == 304
  ) {
    return response
  } else {
    var error = new Error(response.statusText)
    error.response = response
    throw error
  }
}

function defaultBeforeResponse (response) {
  return response.json()
}

function defaultAfterResponse (res) {
  return res;
}

function defaultErrorHandler (err) {
  if (err.name === 'AbortError') {
    console.log('request aborted')
  }
  console.log(err)
}

function unwrapEData(edata) {
    while(edata instanceof EdataBaseClass) {
        edata = edata.value
    }
    return edata
}

export function makeAPI (model, res) {
  const namespace = model.name || model.displayName
  if(!namespace) {
    throw `model should have .name or .displayName: ${JSON.stringify(model)}`
  }
  return data => {
    data = data || {}
    data._store = data._store || {}
    data._actions = data._actions || {}
    data._api = data._api || {}
    data._store[namespace] = new EdataBaseClass({...model.store, ...unwrapEData(data._store[namespace])})
    data._actions[namespace] = new EdataBaseClass({...model.actions, ...unwrapEData(data._actions[namespace])})
    forEach(res, (value, key) => {
      set(data._api, [namespace, key], value)
    })
    const apis = data._api[namespace] || {}
    forEach(model.actions, (value, key)=>{
      if(!(key in apis)) {
        set(data._api, [namespace, key], {})
      }
    })
    return data
  }
}

export function initModel (config, unwrapOptions) {
  return data => edata(data, {
    unwrapConfig: unwrapAPI(unwrapOptions),
    ...config
  })
}

const fakeDomain = 'http://0.0.0.0'
export function unwrapAPI (unwrapOptions = {}) {
  const {paramStyle, queryKey, mockKey} = unwrapOptions
  const ajaxSetting = {...globalAjaxSetting, ...unwrapOptions.ajaxSetting}
  return packer => {
    if (!packer) return
    const { path, root } = packer
    const model = root
    const [prefix, name, service] = path
    if (prefix == '_api' && path.length === 3) {
      return {
        map: apiConfig => {
          return (query, options = {}) =>
            Promise.resolve(
              typeof apiConfig === 'function' ? apiConfig() : apiConfig
            ).then(apiConfig => {
              options = options || {}
              const actions = model.unwrap(['_actions', name]) || {}
              const store = model.unwrap(['_store', name]) || {}
              const actionConfig = { ...ajaxSetting, ...(actions[service] || {}) }
              let {
                exec,
                reducer,
                callback,
                timeout,
                headers,
                checkStatus,
                beforeResponse,
                afterResponse,
                errorHandler
              } = actionConfig
              if (typeof exec === 'string') {
                exec = model.unwrap(['_api', name, exec], {
                  map: v => v
                })
              }
              if (!exec) exec = {...actionConfig, ...apiConfig}
              const success = (callback && callback.success) ||
                    (reducer && reducer.success) ||
                    callback ||
                    reducer
              const onSuccess = (args)=>{
                if (success) {
                  let ret = success(store, args)
                  return Promise.resolve(ret).then((ret)=>{
                    ret = Object.assign(store, ret)
                    model.set(['_store', name], model.of(store))
                    return ret
                  })
                } else {
                  return Promise.resolve(args)
                }
              }
              if(!exec.url) {
                return onSuccess({data: query})
              }
              let mock = exec[mockKey]
              let param = exec[queryKey]
              if(typeof param==='function') {
                param = param()
              }
              // console.log(exec, reducer)
              const method = String(exec.method || 'get').toUpperCase()
              const hasBody = /PUT|POST|PATCH/.test(method)
              const urlParam = paramStyle === 'beatle' ? options.params : options
              const urlObj = new URL(exec.url, fakeDomain)
              urlObj.pathname = replaceParams(urlObj.pathname, ...paramStyle === 'beatle' ? [options.params, options.options] : [options])
              let url = urlObj.toString()
              if(url.indexOf(fakeDomain) === 0) {
                url = url.slice(fakeDomain.length)
              }
              query = {...param, ...query};
              if (!hasBody && !isEmpty(query)) {
                url = url + '?' + qs.stringify(query)
              }
              const controller = new AbortController()
              timeout = Number(exec.timeout || timeout)
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
                  ...headers,
                  ...exec.headers,
                  ...window.ajaxHeader
                },
                body: hasBody ? JSON.stringify(query) : undefined,
                ...options
              }
              const start = callback && callback.start || reducer && reducer.start
              const fail = callback && callback.fail || reducer && reducer.fail
              let startPromise
              if(start) {
                startPromise = start(store, init)
              }

              const onFail = function (err = new Error()) {
                err.isTimeout = isTimeout
                err.init = init
                clearTimeout(timeoutId)
                errorHandler(err)
                if (fail) {
                  const ret = fail(store, err)
                  return Promise.resolve(ret).then(ret => {
                    ret = Object.assign(store, ret)
                    model.set(['_store', name], model.of(store))
                    return ret
                  })
                } else {
                  return Promise.reject(err)
                }
              }

              return Promise.resolve(startPromise).then(()=>{
                let promise = mock
                  ? Promise.resolve(
                    typeof mock === 'function'
                      ? mock()
                      : mock instanceof Response
                        ? mock
                        : new Response(
                          isPOJO(mock) || Array.isArray(mock)
                            ? JSON.stringify(mock)
                            : mock
                        )
                  )
                  : abortableFetch(url, init);
                // console.error(url, init);
                return Promise.race([timeoutPromise, Promise.resolve(startPromise).then(promise)])
                  .then(() => {
                    clearTimeout(timeoutId)
                    return promise
                  })
                  .then(checkStatus)
                  .then(beforeResponse)
                  .then(res => {
                    afterResponse(res)
                    // console.log('res', res, success, service, actions[service]);
                    return onSuccess({
                      data: res,
                      urlParam,
                      param: query,
                      headerParam: init.headers
                    }).then(()=>{
                      return res
                    })
                  })
                  .catch(onFail)
              }).catch(onFail)
            })
        }
      }
    }
  }
}

/**
 * Checks if a value is empty.
 */
export function isEmpty (value) {
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

export function isIterable (value) {
  if (typeof Symbol === 'undefined') {
    return false
  }
  return value[Symbol.iterator]
}
