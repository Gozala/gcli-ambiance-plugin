/* vim:set ts=2 sw=2 sts=2 expandtab */
/*jshint asi: true undef: true es5: true node: true browser: true devel: true
         forin: true latedef: false globalstrict: true */

"use strict";

var GCLI = require("./resource/gcli")
var hub = require('plugin-hub/core'), meta = hub.meta, values = meta.values

var gcli = GCLI.require('gcli/index')
var types = GCLI.require('gcli/types')
var StringType = GCLI.require('gcli/types/basic').StringType
var SelectionType = GCLI.require('gcli/types/selection').SelectionType
var Status = GCLI.require('gcli/types').Status
var Conversion = GCLI.require('gcli/types').Conversion
var Argument = GCLI.require('gcli/argument').Argument

var demo = GCLI.require('demo/index');

exports.name = 'gcli-plug'
exports.version = '0.0.1'
exports.author = 'Irakli Gozalishvili <rfobic@gmail.com>'
exports.description = 'Adapter plguin for GCLI'
exports.stability = 'unstable'

var unbind = Function.call.bind(Function.bind, Function.call)
var owns = unbind(Object.prototype.hasOwnProperty)

// Utility helper function to make interactions with GCLI promises just
// a little bit more saner.
function when(value, resolve, reject) {
  return value && typeof(value.then) === 'function' ?
      value.then(resolve, reject) : resolve(value)
}

function TextType() {
  return StringType.apply(this, arguments)
}
TextType.prototype = Object.create(StringType.prototype)
TextType.prototype.name = 'text'
exports.types = {
  text: TextType
}

var type = meta('Utilities for working with types', exports.type = {})
type.make = meta('Generates type for GCLI', function make(descriptor) {
  var type
  if (Array.isArray(descriptor)) {
    type = new SelectionType({
      name: descriptor.meta && descriptor.meta.name,
      data: descriptor
    })
  }

  if (typeof(descriptor) === 'function') {
    if (descriptor.meta && descriptor.meta.type === 'selection') {
      type = new SelectionType({
        name: descriptor.meta && descriptor.meta.name,
        data: descriptor
      })
    }
    else if (descriptor.meta) {
      type = function type() {}
      type.prototype = new SelectionType({ cacheable: true })
      type.prototype.name = descriptor.meta.name || descriptor.name
      type.prototype.stringify = String
      type.prototype.parse = function parse(input) {
        var result, values = descriptor(input.text)
        values = Array.isArray(values) ? values :
                 values ? [ values ] : []
        values = values.map(function(value) {
          return { name: value, value: value }
        })

        if (values.length > 1)
          result = new Conversion(void(0), input, Status.INCOMPLETE, '', values)
        else if (values.length < 1)
          result = new Conversion(void(0), input, Status.ERROR, '', values)
        else
          result = new Conversion(values[0].value, input, Status.VALID, '', values)

        return result
      }
    }
  }

  if (typeof(descriptor) === 'objects' && descriptor) {
    type = new SelectionType({
      name: descriptor.meta && descriptor.meta.name,
      lookup: function lookup() {
        return Object.keys(descriptor).
          filter(function(name) { return name !== 'meta' }).
          map(function(name) {
            return { name: name, value: descriptor[name] }
          })
      }
    })
  }

  return type
})
type.plug = meta('Plug in the type', function plug(env, descriptor) {
  descriptor.plug = descriptor.meta ? type.make(descriptor) : descriptor
  return types.registerType(descriptor.plug)
})
type.plug.all = meta('Plug all the given types', function unplug(env, types) {
  return types && Object.keys(types).map(function(name) {
    var item = types[name]
    if (!owns(item, 'name')) item.name = name
    if (item.meta && !owns(item.meta, 'name')) item.meta.name = name
    return type.plug(env, item)
  })
})
type.unplug = meta('Uplug the type', function unplug(env, type) {
  return types.unregisterType(type.plug)
})
type.unplug.all = meta('Unplug all the types', function unplug(env, types) {
  return values(types).map(function(name) {
    var item = types[name]
    if (!owns(item, 'name')) item.name = name
    return type.unplug(env, item)
  })
})

var command = meta('Utilities for working with command', exports.command = {})
command.params = meta({
  description: 'Generates paramater signature'
}, function params(env, names, metadata) {
  return names.map(function(name, index) {
    var meta = metadata[index]
    var param = typeof(meta) === "string" ? { type: meta } : meta
    param.name = name
    return param
  })
})

function getParamNames(f) {
  var signature = String(f).
    split('(')[1].
    split(')')[0].
    trim()
  return signature === "" ? [] :
         signature.split(',').map(function(v) { return v.trim() })
}

command.make = meta({
  description: 'Generates command from a normal function'
}, function make(env, name, f) {
  var names = getParamNames(f)
  console.log(names.length)
  return {
    name: name,
    description: f.meta.description,
    params: command.params(env, names, f.meta.takes || []),
    exec: function execute(params, context) {
      var args = Object.keys(params).reduce(function(args, name) {
        args[names.indexOf(name)] = params[name]
        return args
      }, [])
      var deferred = context.createPromise()
      when(f.apply(context, args),
           deferred.resolve.bind(deferred),
           deferred.reject.bind(deferred))
      return deferred
    }
  }
})

command.plug = meta({
  description: 'Plugs in the command'
}, function plug(env, name, f) {
  var commands = env.gcliCommands
  if (f.meta) commands[name] = command.make(env, name, f)
  else commands[name] = Object.defineProperties(f, { name: { value: name }})
  return gcli.addCommand(commands[name])
})
command.unplug = meta({
  description: 'Unplugs given command'
}, function unplug(env, name) {
  var command = env.gcliCommands && env.gcliCommands[name]
  return command && gcli.removeCommand(command)
})

var plugin = meta('Utils for type / command plugs', exports.plugin = {})
plugin.plug = meta('Plugs plugin commands & types', function plug(env, plugin) {
  return plugin.types && type.plug.all(env, plugin.types)
})
plugin.unplug = meta('Unplugs commands & types', function unplug(env, plugin) {
  return plugin.types && type.unplug.all(env, plugin.types)
})

exports.onstartup = meta({
  description: 'Hook that registers all plugin commands & types'
}, function onstartup(env, plugins) {
  var displayView = document.createElement("div")
  displayView.setAttribute("id", "gcli-display")
  document.body.appendChild(displayView)
  displayView.hidden = true

  var inputView = document.createElement("input")
  inputView.setAttribute("id", "gcli-input")
  inputView.setAttribute("class", "gcli-input")
  inputView.setAttribute("type", "text")
  document.body.appendChild(inputView)

  inputView.addEventListener('keyup', function(event) {
    if (event.keyCode === 27) {
      displayView.hidden = true
      inputView.blur()
      env.broadcast('editor:focus')
    }
  }, false);
  inputView.addEventListener('focus', function(event) {
    displayView.hidden = false
  }, false);

  env.gcliDisplayView = displayView
  env.gcliInputView = inputView
  env.gcliCommands = Object.create(null)
  env.gcli = gcli
  env.GCLI = GCLI

  plugins.forEach(plugin.plug.bind(plugin.plug, env))
  gcli.options = {
    blurDelay: 10,
    outputHeight: 300,
    useFocusManager: true,
    environment: env
  }
  gcli.createView(gcli.options)

  plugin.plug(env, {
    types: {
      env: meta({
        description: 'File URI type',
        type: 'string'
      }, function() {
        return env
      })
    }
  })
})

exports.onshutdown = meta({
  description: 'Hook that unregisters unplugged add-on commands & types'
}, function onshutdown(env) {
  document.body.removeChild(env.gcliDisplayView)
  document.body.removeChild(env.gcliInputView)

  env.gcliDisplayView = null
  env.gcliInputView = null
  env.gcliCommands = null
  env.gcli = null
  env.GCLI = null
})

exports.onplug = plugin.plug
exports.onunplug = plugin.unplug
exports['oncommand:plug'] = command.plug
exports['oncommand:group:plug'] = command.plug
exports['oncommand:unplug'] = command.unplug
exports['oncommand:group:unplug'] = command.unplug
