'use strict';

var EventEmitter = require('events').EventEmitter;
var inherits = require('util').inherits;
var fs = require('fs');
var path = require('path');

var alphabet = require('alphabet').lower;
var handlebars = require('handlebars');
var objectMerge = require('object-merge');
var is = require('annois');
var zip = require('annozip');


var UMD = function UMD(code, options) {
    if(!code) {
        throw new Error('Missing code to convert!');
    }

    EventEmitter.call(this);
    this.code = code;
    this.options = options || {};

    this.template = this.loadTemplate(this.options.template);
};

inherits(UMD, EventEmitter);

UMD.prototype.loadTemplate = function loadTemplate(filepath) {
    var tplPath,
        exists = fs.existsSync;

    if (filepath) {
        if (exists(filepath)) {
            tplPath = filepath;
        }
        else {
            tplPath = path.join(__dirname, 'templates', filepath + '.hbs');

            if (!exists(tplPath)) {
                tplPath = path.join(__dirname, 'templates', filepath);

                if (!exists(tplPath)) {
                    this.emit('error', 'Cannot find template file "' + filepath + '".');
                    return;
                }
            }
        }
    }
    else {
        tplPath = path.join(__dirname, 'templates', 'umd.hbs');
    }

    try {
        return handlebars.compile(fs.readFileSync(tplPath, 'utf-8'));
    }
    catch (e) {
        this.emit('error', e.message);
    }
};

UMD.prototype.generate = function generate() {
    var options = this.options,
        code = this.code,
        // ctx will be the object we pass to the Handlebars template
        ctx = objectMerge({}, options);

    var depsOptions = objectMerge(
        // I'm guessing I need to make some changes in getDependencyDefaults
        getDependencyDefaults(this.options.globalAlias),
        // ...and then in convertDependencyArrays to produce the same format
        convertDependencyArrays(options.deps) || {}
    );

    var defaultDeps = depsOptions['default'].items;
    var deps = defaultDeps ? defaultDeps || defaultDeps.items || [] : [];
    var dependency, dependencyType, items, prefix, separator, suffix;

    // dependencyType in ['amd', 'cjs', 'global']
    for (dependencyType in depsOptions) {
        dependency = depsOptions[dependencyType];
        // items contains the module names we will be requiring
        items = dependency.items || defaultDeps || [];
        // probably add an array with (optionally) the object names to import from modules?
        // E.G. given: items == ['moduleA', 'moduleB', 'moduleC'] 
        //             imports == ['importFromA', 'importFromB', 'importFromC']
        // the two arrays would have to be in synch, but I'm thinking we can use 
        // convertDependencyArrays to do this for us, so the user only has to specify
        // imports when he actually needs them.
        // imports = dependency.imports || [];
        prefix = dependency.prefix || '';
        separator = dependency.separator || ', ';
        suffix = dependency.suffix || '';

        ctx[dependencyType + 'Dependencies'] = {
            normal: items,
            params: convertToAlphabet(items),
            wrapped: items.map(wrap(prefix, suffix)).join(separator),
            // If we make sure imports is always filled correctly (either with the
            // imported name, or with the module name from items, we can then create
            // a pre-wrapped version that is ready to insert into the template
            // wrappedImport: imports.join(separator),
        };
    }

    ctx.dependencies = deps.join(', ');

    ctx.code = code;

    return this.template(ctx);
};

function convertToAlphabet(items) {
    return items.map(function(_, i) {
        return alphabet[i] + i;
    });
}

function wrap(pre, post) {
    pre = pre || '';
    post = post || '';

    return function (v) {
        return pre + v + post;
    };
}

// I'm not sure about the format of deps... 
// Something like this ??
// deps == {
//    'default': ['moduleA', 'moduleB', 'moduleC'],
//    'amd': ['moduleA', 'moduleB'],
//    'cjs': ['moduleA', 'moduleC']
// }
function convertDependencyArrays(deps) {
    if(!deps) {
        return;
    }

    // I'm having trouble understanding this code...
    // Here is what I *think* it's doing:
    // Given deps from comment above, it would produce:
    // {
    //    'default': {
    //       items: ['moduleA', 'moduleB', 'moduleC']
    //    },
    //    'amd': {
    //       items: ['moduleA', 'moduleB']
    //    },
    //    'cjs': {
    //       items: ['moduleA', 'moduleC']
    //    },
    // }
    // If this assumption holds, I think changes have to be made
    // here so we can convert from:
    // deps == {
    //    'default': ['moduleA', {'moduleB': 'importB'}, 'moduleC'],
    //    'amd': ['moduleA', {'moduleB': 'importB'}],
    //    'cjs': ['moduleA', 'moduleC']
    // }
    // to:
    // {
    //    'default': {
    //       items: ['moduleA', 'moduleB', 'moduleC'],
    //       imports: ['moduleA', 'importB', 'moduleC'],
    //    },
    //    'amd': {
    //       items: ['moduleA', 'moduleB']
    //       imports: ['moduleA', 'importB'],
    //    },
    //    'cjs': {
    //       items: ['moduleA', 'moduleC']
    //       imports: ['moduleA', 'moduleC'],
    //    },
    // }
    
    return zip.toObject(zip(deps).map(function(pair) {
        if(is.array(pair[1])) {
            // I think we have to add something here... 
            // var items = [], imports = [];
            // for (var i=0,item; item=pair[1][i]; i++) {
            //    if (typeof item === 'object') {
            //       for (var dep in item) {
            //          items.push(dep);
            //          imports.push(item[dep]);
            //       }
            //    }
            //    else {
            //       items.push(item);
            //       imports.push(item);
            //    }
            // }
            // return [pair[0], {
            //    items: items,
            //    imports: imports
            // }];
            //
            return [pair[0], {
                items: pair[1]
            }];
        }

        return pair;
    }));
}

function getDependencyDefaults(globalAlias) {
    return {
        'default': {
            items: null,
            // imports: null,
        },
        amd: {
            items: null,
            // imports: null,
            prefix: '\"',
            separator: ',',
            suffix: '\"',
        },
        cjs: {
            items: null,
            // imports: null,
            prefix: 'require(\"',
            separator: ',',
            suffix: '\")',
        },
        global: {
            items: null,
            // imports: null,
            prefix: globalAlias? globalAlias + '.': '\"',
            separator: ',',
            suffix: '\"',
        }
    };
}

module.exports = function(code, options) {
    var u = new UMD(code, options);

    return u.generate();
};
