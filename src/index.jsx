
import React from 'react'
import PropTypes from 'prop-types'
import * as History from 'history'
import {
  Router,
  Route,
  Switch,
} from 'react-router'
import qs from 'qs'

import { makeAPI, initModel, joinPath, getAPIFactoryFromModel } from './util'
import matchPath from './match-path'
import { Provider, connect } from 'react-redux'
import { createStore } from 'redux'

const createBrowserHistory = History.createHistory || History.createBrowserHistory
const createHashHistory = History.createHashHistory

export default class EdataRouterClass {
  constructor({
    initData = {},
    name,
    debug = false,
    routeMode = 'hash',
    paramStyle = 'simple',
    queryKey = 'param',
    mockKey = 'mock',
    edataConfig,
    ajaxConfig,
    historyConfig
  } = {}) {
    this.data = initData
    this.name = name
    this.routeMode = routeMode
    this.options = {
      initData,
      name,
      debug,
      routeMode,
      paramStyle,
      queryKey,
      mockKey,
      edataConfig,
      ajaxConfig,
      historyConfig
    }
    this.makeModel = initModel(edataConfig, { ajaxSetting: ajaxConfig, debug, paramStyle, queryKey, mockKey })
  }
  model(modelActions, modelObject) {
    if (typeof modelActions === 'function') {
      modelActions(this.data)
    } else {
      // makeAPI({name: '_global', ...modelActions}, modelObject)(this.data)
      makeAPI({ ...modelActions }, modelObject)(this.data)
    }
  }
  route(routes) {
    this.routes = routes
  }
  run(options = {}) {
    let curHooksBranch = []
    const { routes, data, options: { routeMode, historyConfig } } = this
    const {model, apiProps} = this.model = window.model = this.makeModel(data)
    const isHashMode = routeMode === 'hash'
    // const Router = isHashMode ? HashRouter : BrowserRouter
    const history = this.history = (isHashMode ? createHashHistory : createBrowserHistory)({
      // getUserConfirmation: (message, callback) => callback(window.confirm(message))
      ...historyConfig
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

    const reducer = (state, action) => {
      // console.log('reducer', store, action)
    }
    const store = createStore(reducer)

    const { getAPIFromRoute } = getAPIFactoryFromModel(model)

    var componentMap = {}
    function getPathForComponent(route) {
      const { path, component, api = [] } = route
      if (path in componentMap) {
        return componentMap[path]
      } else {
        // const allApiNames = arrayUniq(arrayFlat(api.map(expandAPINameItem)))
        const mapStateToProps = (state, ownProps) => { }
        const mapDispatchToProps = (dispatch, ownProps) => {
          const props = getAPIFromRoute(route)
          Object.keys(props).map(name => {
            const service = props[name]
            for (let name in service) {
              const f = service[name]
              if (typeof f === 'function') {
                service[name] = function (...args) {
                  const ret = f.apply(this, args)
                  Promise.resolve(ret).then(() => {
                    dispatch({ type: 'action' })
                  })
                  return ret
                }
              }
            }
          })
          return props
        }
        return componentMap[path] = connect(mapStateToProps, mapDispatchToProps, null, { pure: false })(component)
      }
    }

    function RouteWithSubRoutes(route) {
      const { model, modelName } = route
      let subModule = model
      if (modelName) {
        if (model.get(modelName) == null) {
          model.set(modelName, {})
        }
        subModule = model.cut(modelName)
      }
      const isRoot = !route.path
      return (
        <Route
          path={route.path}
          exact={route.exact}
          strict={route.strict}
          render={props => {
            // console.log(props)
            const childRoutes = route.routes || route.childRoutes || route.children
            props.location.query = qs.parse(props.location.search.slice(1))
            const RouteComponent = getPathForComponent(route)
            return (
              // pass the sub-routes down to keep nesting
              <RouteComponent
                {...props}
                routeParams={props.match.params || {}}
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
              </RouteComponent>
            )
          }}
        />
      )
    }
    function computeLocationHooks(location) {
      const branch = matchRoutes(routes, location.pathname)
      const getState = (v, location, routes) => {
        if (!location.query) {
          location.query = qs.parse(location.search.slice(1))
        }
        return {
          location: { ...location },
          params: (v.match || {}).params || {},
          routes: routes.map(v => v.route)
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

    class App extends React.Component {
      getChildContext = () => {
        return {
          router: {
            ...history,
            isActive(pathname) {
              pathname = pathname.trim().replace(/\/$/, '')
              return curHooksBranch.some((e) => ((e.match || {}).path || '').indexOf(pathname) === 0)
            }
          }
        }
      }
      render() {
        return (
          <Provider store={store}>
            <Router history={history}>
              <Switch>
                {routes.map((route, i) => (
                  <RouteWithSubRoutes key={i} {...route} model={model} />
                ))}
              </Switch>
            </Router>
          </Provider>
        )
      }
    }
    App.childContextTypes = {
      router: PropTypes.object
    };
    return App
  }
}

function routeDifference(arr1, arr2) {
  var result = []
  arr2 = arr2.map(v => v.route)
  for (var i = 0; i < arr1.length; i++) {
    if (arr2.indexOf(arr1[i].route) === -1) {
      result.push(arr1[i])
    }
  }
  return result
}

/** From react-router-config/matchRoutes
 * Add childRoutes support
 * https://github.com/ReactTraining/react-router/blob/master/packages/react-router-config/modules/matchRoutes.js
 */
function matchRoutes(routes, pathname, /* not public API */ options = {}) {
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

      const childRoutes = route.routes || route.childRoutes || route.children
      if (childRoutes) {
        matchRoutes(childRoutes, pathname, { branch, path: fullPath })
      }
    }

    return match
  })

  return branch
}

function computeRootMatch(pathname) {
  return {
    path: "/",
    url: "/",
    params: {},
    isExact: pathname === "/"
  }
}
