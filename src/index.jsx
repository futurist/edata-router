
import React from 'react'
import PropTypes from 'prop-types'
import * as History from 'history'
import {
  Router,
  Route,
  Switch,
} from 'react-router'
import qs from 'qs'
import { makeAPI, initModel } from './util'
import matchPath from './match-path'

const createBrowserHistory = History.createHistory || History.createBrowserHistory
const createHashHistory = History.createHashHistory

export default class InitClass {
  constructor ({
      initData = {},
      name,
      routeMode = '',
      paramStyle = 'simple',
      edataConfig,
      ajaxSetting
    } = {}) {
    this.data = initData
    this.name = name
    this.routeMode = routeMode
    this.makeModel = initModel(edataConfig, {ajaxSetting, paramStyle})
  }
  model (modelActions, modelObject) {
    if(typeof modelActions==='function') {
      modelActions(this.data)
    } else {
      // makeAPI({name: '_global', ...modelActions}, modelObject)(this.data)
      makeAPI({...modelActions}, modelObject)(this.data)
    }
  }
  route (routes) {
    this.routes = routes
  }
  run () {
    let curHooksBranch = []
    const { routes, data, routeMode } = this
    const model = this.model = window.model = this.makeModel(data)
    const isHashMode = routeMode === 'hash'
    // const Router = isHashMode ? HashRouter : BrowserRouter
    const history = this.history = (isHashMode ? createHashHistory : createBrowserHistory)({
      // getUserConfirmation: (message, callback) => callback(window.confirm(message))
    })
    let curLocation = history.location || window.location

    history.listen((location, action) => {
      computeLocationHooks(location)
      if (history.unblock) {
        history.unblock()
        history.unblock = null
      }
    })

    computeLocationHooks(curLocation)
    class App extends React.Component {
      getChildContext = () => {
        return {
          router: {
            ...history,
            isActive(pathname) {
              pathname = pathname.trim().replace(/\/$/, '')
              return curHooksBranch.some((e)=> ((e.match||{}).path||'').indexOf(pathname) === 0 )
            }
          }
        }
      }
      render () {
        return (
          <Router history={history}>
            <Switch>
              {routes.map((route, i) => (
                <RouteWithSubRoutes key={i} {...route} model={model} />
              ))}
            </Switch>
          </Router>
        )
      }
    }
    App.childContextTypes = {
      router: PropTypes.object
    };

    return App

    function getAPIFromRoute ({ api = [] }) {
      const props = {}
      // const apiObj = model.unwrap(['_api', '_global']) || {}
      // Object.keys(apiObj).forEach((key) => {
      //   props[key] = model.unwrap(['_api', '_global', key])
      // })
      // props.store = model.unwrap(['_store', '_global']) || {}

      const allAPI = Object.keys(model.get(['_api']).value)
      api.forEach(val => {
        let names = [val]
        if(val instanceof RegExp){
          names = allAPI.filter(v=>val.test(v))
        }
        if(val === '*') {
          names = allAPI
        }
        names.filter(Boolean).forEach(name=>{
          const services = {}
          props[name] = services
          const apiObj = model.get(['_api', name]).value
          Object.keys(apiObj).forEach((key) => {
            services[key] = model.unwrap(['_api', name, key])
          })
          services.store = model.unwrap(['_store', name]) || {}
        })
      })
      return props
    }

    function RouteWithSubRoutes (route) {
      const { model, modelName } = route
      let subModule = model
      if (modelName) {
        if (model.get(modelName) == null) {
          model.set(modelName, {})
        }
        subModule = model.slice(modelName)
      }
      const isRoot = !route.path
      return (
        <Route
          path={route.path}
          exact={route.exact}
          strict={route.strict}
          render={props => {
            // console.log(props)
            const childRoutes = route.routes || route.childRoutes
            props.location.query = qs.parse(props.location.search.slice(1))
            return (
              // pass the sub-routes down to keep nesting
              <route.component
                {...props}
                routeParams={props.match.params || {}}
                {...getAPIFromRoute(route)}
                model={subModule}
              >
                <Switch>
                  {childRoutes &&
                    childRoutes.map((childRoute, i) => {
                      const path = joinPath(route.path, childRoute.path)
                      return (
                        <RouteWithSubRoutes
                          key={i}
                          {...childRoute}
                          path={path}
                          model={subModule}
                        />
                      )
                    })}
                </Switch>
              </route.component>
            )
          }}
        />
      )
    }
    function computeLocationHooks (location) {
      const branch = matchRoutes(routes, location.pathname)
      const getState = (v, location, routes) => {
        if(!location.query) {
          location.query = qs.parse(location.search.slice(1))
        }
        return {
          location: {...location},
          params: (v.match||{}).params || {},
          routes: routes.map(v=>v.route)
        }
      };
      const exitList = routeDifference(curHooksBranch, branch)
      exitList.reverse().forEach(v => {
        // console.log('----onLeave')
        v.route.onLeave &&
          v.route.onLeave.call(v.route, getState(v, curLocation, curHooksBranch))
      })
      branch.forEach(v => {
        const { route } = v
        const prevState = getState(v, curLocation, curHooksBranch)
        const nextState = getState(v, location, branch)
        route.onChange &&
          route.onChange.call(route, prevState, nextState, history.replace)
        const found = curHooksBranch.find(x => x.route === route)
        if (!found) {
          // console.log('----onEnter', route.path)
          route.onEnter && route.onEnter.call(route, nextState, history.replace)
        }
      })
      window.curHooksBranch = curHooksBranch = branch
      curLocation = location
    }
  }
}

function routeDifference (arr1, arr2) {
  var result = []
  arr2 = arr2.map(v => v.route)
  for (var i = 0; i < arr1.length; i++) {
    if (arr2.indexOf(arr1[i].route) === -1) {
      result.push(arr1[i])
    }
  }
  return result
}

function joinPath (prev, url) {
  prev = prev || ''
  if (url[0] != '/') url = '/' + url
  if (prev[prev.length - 1] == '/') prev = prev.slice(0, -1)
  return prev + url
}

/** From react-router-config/matchRoutes
 * Add childRoutes support
 * https://github.com/ReactTraining/react-router/blob/master/packages/react-router-config/modules/matchRoutes.js
 */
function matchRoutes (routes, pathname, /* not public API */ options = {}) {
  const { branch = [] } = options
  routes.some(route => {
    const fullPath = joinPath(options.path, route.path)
    const match = route.path
      ? matchPath(pathname, { ...route, path: fullPath })
      : branch.length
        ? branch[branch.length - 1].match // use parent match
        : computeRootMatch(pathname) // use default "root" match

    if (match) {
      branch.push({ route, match })

      const childRoutes = route.routes || route.childRoutes
      if (childRoutes) {
        matchRoutes(childRoutes, pathname, { branch, path: fullPath })
      }
    }

    return match
  })

  return branch
}

function computeRootMatch (pathname) {
  return {
    path: "/",
    url: "/",
    params: {},
    isExact: pathname === "/"
  }
}
