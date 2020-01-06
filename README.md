# edata-router

## 文件结构

File tree:

```
index.jsx          # 主入口
routes.js         # 路由配置
actions/          ＃ 接口动作(success/fail等)
├── index.js
├── products.js
└── users.js
```

## 主入口 index.jsx

```js
import React from 'react'
import {render} from 'react-dom'
import EdataRouter from 'edata-router'
import {actions1, actions2} from './actions'

const app = new EdataRouter({
  ajaxConfig: {
    headers: {},
    beforeRequest: (init)=>{},
    getResponse: (response)=>{},
    afterResponse: (response)=>{},
    errorHandler: (error)=>{}
  }
})

// 导入接口配置
app.model(actions1)

const actions2ResourceDef = {
  getList: {
    url: '/analysis/api/products/cat/:id',
    method: 'GET',
  }
}
// 可选传入资源定义
app.model(actions2, actions2ResourceDef)
... ...

// 设置路由
app.route(routes)

// 挂载运行
const App = app.run()
render(<App></App>, document.getElementById('main'))

```


## 接口定义  (actions/)

### actions

每个模块都需导出如下结构：

```js
module.exports = {
    name: 'products',  // 必填
    store: {},
    actions: {
        getList: {
          url: '/analysis/api/products/cat/:id',
          method: 'GET',
          param: () => ({  //支持对象(静态配置)，函数(动态生成)
              workspaceCode: window.workspace
          }),
          callback: {
              start: function (store, init) {
              },
              success: function (store, result) {
              },
              fail: function (store, err) {
              }
          }
        },
        ... ...
    }
}
```


## 路由配置 (routes.js)

```js
export default [
  {
    path: basename,     // 必选
    component: Header,  // 必选
    // modelName: 'base',  // 可选, 相当于 `edata.slice(base)`
    api: ['products', 'users'],  //可选, '*' 表示所有可用API，也可为正则
    onEnter: function (nextState, replaceState) {
      // First render of this route
      // replaceState(null, '/messages/' + nextState.params.id)
    },
    onChange: function (prevState, nextState, replaceState) {
      // Every render of this route
    },
    childRoutes: [
        {path, component},
        ...
    ]
  }
]
```

`Header`组件中，以下方法自动可用:

```js
this.props.products.getList(
  query,
  {
    id: 123
  }
)

this.props.products.store   // store是action中定义的那个对象

this.props.model  // model是一个edata
this.props.routeParams  // 对应于 props.match.params
this.props.history
this.props.location
this.props.match
```
