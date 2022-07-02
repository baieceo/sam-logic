'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

var logicTpl = `import nodeFns from './nodeFns';
import Context from './context';
import EventEmitter from 'eventemitter3';

const LIFECYCLE = new Set(['ctxCreated', 'enterNode', 'leaveNode']);
const SHAPES = {
  START: 'sami-start',
  BRANCH: 'sami-branch',
  BEHAVIOR: 'sami-behavior',
};

export default class Logic extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.dsl = opts.dsl;
    this.lifeCycleEvents = {};
  }

  get cells() {
    return this.dsl.cells;
  }

  get nodes() {
    return this.cells.filter((cell) => cell.shape !== 'edge');
  }

  get startNodes() {
    return this.cells.filter((cell) => cell.shape === SHAPES.START);
  }

  get edges() {
    return this.cells.filter((cell) => cell.shape === 'edge');
  }

  _getUnsafeCtx() {
    // NOTE: don't use in prod
    return this._unsafeCtx;
  }

  _runLifecycleEvent(eventName, ctx) {
    if (!LIFECYCLE.has(eventName)) {
      return console.warn(\`Lifecycle \${eventName} is not supported!\`);
    }
    if (this.lifeCycleEvents[eventName]) {
      this.lifeCycleEvents[eventName].forEach((fn) => fn(ctx));
    }
  }

  _createCtx(opts) {
    const ctx = new Context(opts);
    ctx.emit = this.emit.bind(this);
    this._runLifecycleEvent('ctxCreated', ctx);
    return ctx;
  }

  _getStartNode(trigger) {
    for (const cell of this.startNodes) {
      if (cell.data.trigger === trigger) {
        return cell;
      }
    }
  }

  _getNextNodes(ctx, curNode, curRet) {
    const nodes = [];

    // NOTE: if it is a sami-branch node, find out which port match the curRet condition
    const isCurNodeShapeBranch = curNode.shape === SHAPES.BRANCH;
    let curNodeMatchedPort = '';
    if (isCurNodeShapeBranch) {
      const { ports } = curNode.data;
      for (const key in ports) {
        const { condition } = ports[key];
        // eslint-disable-next-line no-new-func
        const ret = new Function('ctx', 'return ' + condition)(ctx);
        if (ret === Boolean(curRet)) {
          curNodeMatchedPort = key;
          break; // for (const key in ports)
        }
      }
    }

    // NOTE: find out next node via edges which source is curNode
    for (const edge of this.edges) {
      // edge's source is curNode
      const isMatchedSource = edge.source.cell === curNode.id;
      // if it is a sami-branch node, edge.source.port match curRet condition
      const isMatchedPort = !isCurNodeShapeBranch || edge.source.port === curNodeMatchedPort;
      if (isMatchedSource && isMatchedPort) {
        // NOTE: not each edge both has source and target
        const nextNode = this.nodes.find((item) => item.id === edge.target.cell);
        nextNode && nodes.push(nextNode);
      }
    }
    return nodes;
  }

  use(pluginCreator) {
    if (typeof pluginCreator !== 'function') {
      console.error('sami plugin must be a function.');
      return;
    }
    const plugin = pluginCreator(this);
    if (typeof plugin !== 'object' || plugin === null) {
      console.error('sami plugin must return an object.');
      return;
    }
    for (const eventName in plugin) {
      if (!Object.prototype.hasOwnProperty.call(plugin, eventName)) {
        continue;
      }
      if (!LIFECYCLE.has(eventName)) {
        console.warn(\`Lifecycle \${eventName} is not supported in sami.\`);
        continue;
      }
      if (!this.lifeCycleEvents[eventName]) {
        this.lifeCycleEvents[eventName] = [];
      }
      this.lifeCycleEvents[eventName].push(plugin[eventName]);
    }
  }

  async _execNode(ctx, curNode, lastRet, callback) {
    ctx._transitTo(curNode, lastRet);
    const fn = nodeFns[curNode.id];
    this._runLifecycleEvent('enterNode', ctx);
    const curRet = await fn(ctx);
    this._runLifecycleEvent('leaveNode', ctx);
    if (curNode.shape !== SHAPES.BRANCH) {
      lastRet = curRet;
    }
    const nextNodes = this._getNextNodes(ctx, curNode, curRet);
    if (nextNodes.length > 0) {
      nextNodes.forEach(async (node) => {
        await this._execNode(ctx, node, lastRet, callback);
      });
    } else {
      callback && callback(lastRet);
    }
  }

  async invoke(trigger, data, callback) {
    const curNode = this._getStartNode(trigger);
    if (!curNode) {
      return Promise.reject(new Error(\`Invoke failed! No logic-start named \${trigger} found!\`));
    }
    this._unsafeCtx = this._createCtx({ payload: data });
    await this._execNode(this._unsafeCtx, curNode, undefined, callback);
  }
}
`;

var contextTpl = `export default class Context {
  constructor(opts) {
    this._init(opts);
  }

  _init(opts = {}) {
    const { payload = {} } = opts;
    this.curNode = null;
    this.context = {};
    this.payload = Object.freeze({ ...payload });
  }

  _transitTo(node, lastRet) {
    this.curNode = node;
    this.lastRet = lastRet;
  }

  getConfig() {
    return this.curNode.data.configData;
  }

  getPayload() {
    return this.payload;
  }

  getPipe() {
    return this.lastRet;
  }

  getContext() {
    return this.context;
  }

  setContext(data = {}) {
    Object.keys(data).forEach((key) => {
      this.context[key] = data[key];
    });
  }
}
`;

const makeCode = (mockNode, mockInput) => `
(async function run() {
  // Context
  ${contextTpl.replace(/export\s+default/, '')}

  // Logic
  ${logicTpl
    .split('\n')
    .filter(
      (line) => !line.match(/import nodeFns/) && !line.match(/import Context/),
    )
    .join('\n')
    .replace(/export\s+default/, '')
    .replace(
      `import EventEmitter from 'eventemitter3';`,
      `const EventEmitter = (await import('https://jspm.dev/eventemitter3')).default;`,
    )}

  // DSL
  // define dsl here

  // nodeFns map
  // define nodeFns here

  // sami plugin
  const mockPlugin = () => {
    const mockNode = ${JSON.stringify(mockNode)};
    const mockInput = ${JSON.stringify(mockInput)};
    const toMockTargets = [
      ['pipe', 'getPipe'],
      ['config', 'getConfig'],
      ['payload', 'getPayload'],
      ['context', 'getContext'],
    ];
    return {
      enterNode(ctx) {
        // hijack
        if(ctx.curNode.id === mockNode.id) {
          toMockTargets.forEach(item => {
            const [type, method] = item;
            item[2] = ctx[method];
            ctx[method] = () => mockInput[type];
          });
        }
      },
      leaveNode(ctx) {
        // restore
        if(ctx.curNode.id === mockNode.id) {
          toMockTargets.forEach(item => {
            const [type, method, originMethod] = item;
            ctx[method] = originMethod;
          });
        }
      }
    };
  };

  // instantiation and invoke
  const logic = new Logic({ dsl });
  logic.use(mockPlugin);
  logic.invoke('$TRIGGER$', {}, (pipe) => {
    const ctx = logic._getUnsafeCtx();
    const context = ctx.getContext();
    window.dispatchEvent(new CustomEvent('samiOnlineExecEnds', {detail: {pipe, context}}));
  });
})().catch(err => {
  console.error(err.message);
  window.dispatchEvent(new CustomEvent('samiOnlineExecEnds', {detail: {error: {message: err.message}}}));
});
`;

const extractObj = (
    obj = {},
    keys = [],
) => {
    const ret = {};
    keys.forEach((key) => {
        if (obj[key]) {
            ret[key] = obj[key];
        }
    });
    return ret;
};

const simplifyDSL = (dsl) => {
    const { cells = [] } = dsl;
    return {
        cells: cells.map((cell) => {
            if (cell.shape === 'edge') {
                return extractObj(cell, ['id', 'shape', 'source', 'target']);
            } else {
                const newCell = extractObj(cell, ['id', 'shape', 'data']);
                newCell.data = extractObj(cell.data, [
                    'trigger',
                    'configData',
                    'ports',
                ]);
                return newCell;
            }
        }),
    };
};

/* eslint-disable no-useless-escape */
/**
 * Solution
 *
 * 1. find the source node form dsl, and if it is not sami-start,
 * then insert a vitural sami-start at first.
 *
 * 2. transform node funciton, follows should be noted:
 *    - import statement should be replaced with import('packge/from/network')
 *    - export statement should be replace with return function
 *    - each node function should be wrapped within a new function to avoid duplicate declaration global variable
 *
 * 3. assemble Logic, Context, simplyfied dsl and nodeFns map into one file
 *
 */

const INSERT_DSL_COMMENT = '// define dsl here';
const INSERT_NODE_FNS_COMMENT = '// define nodeFns here';
const importRegex = /import\s([\s\S]*?)\sfrom\s('|")((@\w[\w\.\-]+\/)?(\w[\w\.\-\/]+))\2/gm;
const virtualSourceNode = {
    id: 'virtual-sami-start',
    shape: 'sami-start',
    data: {
        trigger: 'virtual-sami-start',
        configData: {},
        code: 'export default async function(ctx) {\n  \n}',
    },
};

const findStartNode = (dsl) => {
    const nodes = dsl.cells.filter((cell) => cell.shape !== 'edge');
    const edges = dsl.cells.filter((cell) => cell.shape === 'edge');

    if (nodes.length === 0) {
        throw new Error('Compile failed, no node is selected');
    }

    let foundEdge = null;
    let startNode = nodes[0];
    while (
        (foundEdge = edges.find((edge) => edge.target.cell === startNode.id))
    ) {
        const newSourceId = foundEdge.source.cell;
        startNode = nodes.find(
            (node) => node.id === newSourceId,
        );
    }

    if (startNode.shape !== 'sami-start') {
        dsl.cells.push(virtualSourceNode, {
            shape: 'edge',
            source: {
                cell: 'virtual-sami-start',
            },
            target: {
                cell: startNode.id,
            },
        });
        startNode = virtualSourceNode;
    }

    return startNode;
};

const getNextNode = (curNode, dsl) => {
    const nodes = dsl.cells.filter((cell) => cell.shape !== 'edge');
    const edges = dsl.cells.filter((cell) => cell.shape === 'edge');

    const foundEdge = edges.find((edge) => edge.source.cell === curNode.id);
    if (foundEdge) {
        return nodes.find((node) => node.id === foundEdge.target.cell);
    }
};

const compileSimplifiedDSL = (dsl) => {
    const simplyfiedDSL = JSON.stringify(simplifyDSL(dsl), null, 2);
    return `const dsl = ${simplyfiedDSL};`;
};

const compileNodeFn = (node) => {
    const {
        data: { /* label, */ code },
    } = node;
    const newCode = code
        .replace(
            importRegex,
            (match, p1, p2, p3) => {
                return `const ${p1} = (await import('https://jspm.dev/${p3}')).default;`;
            },
        )
        .replace(/export\s+default/, 'return');

    return `await (async function() {
    ${newCode}
  }())`;
};

const compileNodeFnsMap = (dsl) => {
    const nodes = dsl.cells.filter((cell) => cell.shape !== 'edge');
    const kvs = nodes.map((node) => {
        const { id } = node;
        return `'${id}': ${compileNodeFn(node)}`;
    });

    return `const nodeFns = {\n  ${kvs.join(',\n  ')}\n}`;
};

const compile$1 = (dsl, mockInput) => {
    const startNode = findStartNode(dsl);
    const mockNode = getNextNode(startNode, dsl);
    return makeCode(mockNode, mockInput)
        .replace(INSERT_DSL_COMMENT, compileSimplifiedDSL(dsl))
        .replace(INSERT_NODE_FNS_COMMENT, compileNodeFnsMap(dsl))
        .replace('$TRIGGER$', startNode.data.trigger);
};

const INSERT_IMPORT_PLUGINS_COMMENT = '// import plugins here';
const INSERT_USE_PLUGINS_COMMENT = '// use plugins here';
const INSERT_USE_CUSTOM_CODE = '// use custom code';

const addPlugins = (originalCode = '', plugins = [], options) => {
    const modifiedContent = originalCode
        .replace(new RegExp(INSERT_IMPORT_PLUGINS_COMMENT), () => {
            return plugins
                .map((plugin, index) => `import plugin${index} from '${plugin}';`)
                .join('\n');
        })
        .replace(new RegExp(INSERT_USE_PLUGINS_COMMENT), () => {
            return plugins.map((_, index) => `logic.use(plugin${index});`).join('\n');
        })
        .replace(new RegExp(INSERT_USE_CUSTOM_CODE), () => {
            return options.customCode['index.js'];
        });
    return modifiedContent;
};

const genEntryFile = (nodeIds) => {
    const imports = [];
    const funcMaps = [];
    nodeIds.forEach((id, idx) => {
        const funcName = `fn_${idx}`;
        imports.push(`import ${funcName} from './${id}';`);
        funcMaps.push(`'${id}': ${funcName}`);
    });
    const fileContent = [
        imports.join('\n'),
        `const nodeFns = {\n  ${funcMaps.join(',\n  ')}\n};`,
        'export default nodeFns;',
    ].join('\n');
    return fileContent;
};

const genNodeFns = (dsl) => {
    const nodeFns = {};
    const { cells = [] } = dsl;
    const nodes = cells.filter((cell) => cell.shape !== 'edge');
    for (const {
            id,
            shape,
            data: { label, code },
        }
        of nodes) {
        const fileName = id + '.js';
        const descData = `// ${shape}: ${label}\n`;
        const saveData = `${descData}\n${code}`;
        nodeFns[fileName] = saveData;
    }
    return nodeFns;
};

const extract = (dsl) => {
    const nodeFns = genNodeFns(dsl);
    const nodeIds = Object.keys(nodeFns).map((fileName) => fileName.slice(0, -3));
    const entryFileContent = genEntryFile(nodeIds);
    nodeFns['index.js'] = entryFileContent;
    return nodeFns;
};

var indexTpl = `import Logic from './logic';
import dsl from './dsl.json';
// import plugins here

const logic = new Logic({ dsl });

// use plugins here

// use custom code

export default logic;
`;

const compile = (dsl, plugins = [], options = {customCode: {'index.js': ''}}) => {
    const output = {
        nodeFns: extract(dsl),
        'context.js': contextTpl,
        'dsl.json': JSON.stringify(simplifyDSL(dsl), null, 2),
        'index.js': addPlugins(indexTpl, plugins, options),
        'logic.js': logicTpl,
    };
    return output;
};

exports.compileForOnline = compile$1;
exports.compileForProject = compile;
