import { Builder, builder } from '@builder.io/sdk';
import { safeDynamicRequire } from './safe-dynamic-require';

const fnCache: { [key: string]: BuilderEvanFunction | undefined } = {};

type BuilderEvanFunction = (
  state: object,
  event?: Event | undefined | null,
  block?: any,
  builder?: Builder,
  Device?: any,
  update?: Function | null,
  _Builder?: typeof Builder,
  context?: object
) => any;

const logError = ({
  code,
  error,
  context,
  block,
  sandbox,
}: {
  code: string;
  error: any;
  context: any;
  block: any;
  sandbox?: any;
}) => {
  let debugInfo = `For a more detailed error message, restart your server with DEBUG=true set in your environment variables. If you're using npm, yarn, or a similar tool to run your development server, be sure to add DEBUG=true to your script in package.json so that your server can access the environment variable.
`;

  if (process.env.DEBUG) {
    debugInfo = `***BEGIN DEBUG INFO***

Block type: ${block.component.name}
Block ID: ${block.id}
Content item ID: ${context.builderContent.id}
Content item name: ${context.builderContent.name}
`;

    if (Builder.isServer) {
      if (sandbox) {
        debugInfo = debugInfo.concat(`\nServer VM sandbox:\n\n${JSON.stringify(sandbox, null, 2)}\n`);
      }
      debugInfo = debugInfo.concat(`\nError stack trace:\n\n${error.stack}\n\n***END DEBUG INFO***\n`)
    }
  }

  let message = `The Builder React SDK failed to execute the following data binding code on the ${
    Builder.isServer ? 'server' : 'browser'
  }:

  ${code}

The error was

  ${error}

You can inspect the generated code listed above by visiting https://www.builder.io/content/${
    context.builderContent.id
  }/edit?activeDesignerTab=3&selectedBlock=${
    block.id
  } and entering the JSON view for the selected block by right clicking on the block in the Layers tab or by pressing Cmd/Ctrl+E with the block selected. You can also access the data binding itself from the Data tab.
`;

  if (Builder.isServer) message = message.concat(`\n${debugInfo}`);

  console.error(error);
  if (Builder.isServer) {
    console.error(`\n${message}`);
  } else {
    console.error(message);
  }
};

export const api = (state: any) => builder;

export function stringToFunction(
  str: string,
  expression = true,
  errors?: Error[],
  logs?: string[]
): BuilderEvanFunction {
  /* TODO: objedct */
  if (!str || !str.trim()) {
    return () => undefined;
  }

  const cacheKey = str + ':' + expression;
  if (fnCache[cacheKey]) {
    return fnCache[cacheKey]!;
  }

  // FIXME: gross hack
  const useReturn =
    (expression &&
      !(str.includes(';') || str.includes(' return ') || str.trim().startsWith('return '))) ||
    str.trim().startsWith('builder.run');
  let fn: Function = () => {
    /* intentionally empty */
  };

  try {
    // tslint:disable-next-line:no-function-constructor-with-string-args
    if (Builder.isBrowser) {
      // TODO: use strict and eval
      fn = new Function(
        'state',
        'event',
        'block',
        'builder',
        'Device',
        'update',
        'Builder',
        'context',
        // TODO: remove the with () {} - make a page v3 that doesn't use this
        // Or only do if can't find state\s*\. anywhere hm
        `
          var names = [
            'state',
            'event',
            'block',
            'builder',
            'Device',
            'update',
            'Builder',
            'context'
          ];
          var rootState = state;
          if (typeof Proxy !== 'undefined') {
            rootState = new Proxy(rootState, {
              set: function () {
                return false;
              },
              get: function (target, key) {
                if (names.includes(key)) {
                  return undefined;
                }
                return target[key];
              }
            });
          }
          /* Alias */
          var ctx = context;
          with (rootState) {
            ${useReturn ? `return (${str});` : str};
          }
        `
      );
    }
  } catch (error: any) {
    if (errors) {
      errors.push(error);
    }
    const message = error && error.message;
    if (message && typeof message === 'string') {
      if (logs && logs.indexOf(message) === -1) {
        logs.push(message);
      }
    }
    if (Builder.isBrowser) {
      console.warn(`Function compile error in ${str}`, error);
    }
  }

  const final = (...args: any[]) => {
    if (Builder.isBrowser) {
      try {
        return fn(...args);
      } catch (error: any) {
        logError({
          code: str,
          error: error,
          context: args[7],
          block: args[2],
        });

        if (errors) {
          errors.push(error);
        }
      }
    } else {
      // TODO: memoize on server
      // TODO: use something like this instead https://www.npmjs.com/package/rollup-plugin-strip-blocks
      // There must be something more widely used?
      // TODO: regex for between comments instead so can still type check the code... e.g. //SERVER-START ... code ... //SERVER-END
      // Below is a hack to get certain code to *only* load in the server build, to not screw with
      // browser bundler's like rollup and webpack. Our rollup plugin strips these comments only
      // for the server build
      // TODO: cache these for better performancs with new VmScript
      // tslint:disable:comment-format
      const { VM } = safeDynamicRequire('vm2');
      const [state, event, block, _builder, _Device, _update, _Builder, context] = args;
      const sandbox = {
        ...state,
        ...{ state },
        ...{ builder: api },
        event,
      };
      const timeout = 100;
      const vm = new VM({
        timeout,
        sandbox,
      });

      try {
        // TODO: memoize on server
        // TODO: use something like this instead https://www.npmjs.com/package/rollup-plugin-strip-blocks
        // There must be something more widely used?
        // TODO: regex for between comments instead so can still type check the code... e.g. //SERVER-START ... code ... //SERVER-END
        // Below is a hack to get certain code to *only* load in the server build, to not screw with
        // browser bundler's like rollup and webpack. Our rollup plugin strips these comments only
        // for the server build
        // TODO: cache these for better performancs with new VmScript
        // tslint:disable:comment-format
        const { VM } = safeDynamicRequire('vm2');
        const [state, event, _block, _builder, _Device, _update, _Builder, context] = args;

        return new VM({
          timeout: 100,
          sandbox: {
            ...state,
            ...{ state },
            ...{ context },
            ...{ builder: api },
            event,
          },
        }).run(str.replace(/(^|;)return /, '$1'));
        // tslint:enable:comment-format
      } catch (error: any) {
        logError({
          code: str,
          error,
          context,
          block,
          sandbox,
        });

        if (errors) {
          errors.push(error);
        }
      }
    }
  };

  if (Builder.isBrowser) {
    fnCache[cacheKey] = final;
  }

  return final;
}
