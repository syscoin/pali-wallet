// Based on Split by Name Webpack Plugin – https://github.com/soundcloud/split-by-name-webpack-plugin

// const webpack = require('webpack');

function regExpQuote(str) {
  return (str + '').replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, '\\$&');
}

/**
 * @name Bucket
 * @property {String} name
 * @property {Array<String|RegExp>} path
 */

/**
 *
 * @param {Bucket[]} buckets - instances of Bucket
 * @param {Object} config - configurable options include:
 * <pre>
 * {
 *    ignore: string[],
 *    ignoreChunks: string[]
 *    manifest: string
 * }
 * </pre>
 * @constructor
 */
function SplitByPathPlugin(buckets, config) {
  config = config || {};
  config.ignore = config.ignore || [];
  config.ignoreChunks = config.ignoreChunks || [];

  if (!Array.isArray(config.ignore)) {
    config.ignore = [config.ignore];
  }

  if (!Array.isArray(config.ignoreChunks)) {
    config.ignoreChunks = [config.ignoreChunks];
  }

  this.ignore = config.ignore.map(function (item) {
    if (item instanceof RegExp) {
      return item;
    }

    return new RegExp('^' + regExpQuote(item));
  });

  this.ignoreChunks = config.ignoreChunks;
  this.manifest = config.manifest || 'manifest';

  // buckets mean each bucket holds a pile of module, which is the same concept as chunk
  this.buckets = buckets.slice(0).map(function (bucket) {
    if (!Array.isArray(bucket.path)) {
      bucket.path = [bucket.path];
    }

    bucket.path = bucket.path.map(function (path) {
      if (path instanceof RegExp) {
        return path;
      }

      return new RegExp('^' + regExpQuote(path));
    });

    return bucket;
  });
}

SplitByPathPlugin.prototype.apply = function (compiler) {
  var buckets = this.buckets;
  var ignore = this.ignore;
  var ignoreChunks = this.ignoreChunks;
  var manifestName = this.manifest;

  const { hooks } = compiler;

  if (hooks) {
    hooks.compilation.tap('SplitByPathPlugin', function (compilation) {
      var extraChunks = {};

      function bucketToChunk(bucket) {
        return extraChunks[bucket.name];
      }

      compilation.hooks.processAssets.tap(
        'SplitByPathPlugin',
        function (chunks) {
          var addChunk = compilation.addChunk.bind(compilation);

          var entryChunks = Array.from(chunks)
            .filter(function (chunk) {
              chunk.canBeInitial() &&
                chunk.name &&
                !this.ignoreChunks.includes(chunk.name);
            })
            .map((chunkMaped) => {
              Array.from(
                compilation.chunkGraph.getChunkModulesIterable(chunkMaped)
              ).forEach((mod) => {
                var bucket = findMatchingBucket(mod, this.ignore, this.buckets);

                var newChunk;

                if (!bucket) return;

                newChunk = addChunk(bucket.name);
                extraChunks[bucket.name] = newChunk;
                compilation.entrypoints.get(bucket.name).insertChunk(newChunk);
                newChunk.addModule(mod);
                mod.addChunk(newChunk);
                mod.removeChunk(chunkMaped);
              });
              return chunkMaped;
            });

          var notEmptyBucketChunks = buckets.map(bucketToChunk).filter(Boolean);

          var manifestChunk = addChunk(manifestName);
          manifestChunk.chunks = notEmptyBucketChunks.concat(entryChunks);

          manifestChunk.chunks.forEach(function (chunk) {
            chunk.setRuntimeChunk(manifestChunk);
            Array.from(
              compilation.chunkGraph.getChunkModulesIterable(chunk)
            ).forEach(function (entry) {
              compilation.entrypoints.get(entry.name).insertChunk(chunk);
            });
          });
        }
      );
    });
  }
};

module.exports = SplitByPathPlugin;

function findMatchingBucket(mod, ignore, bucketsContext) {
  var match = null;

  if (!mod.resource) {
    return match;
  }

  var resourcePath = mod.resource;
  for (var i in ignore) {
    if (ignore[i].test(resourcePath)) {
      return match;
    }
  }

  bucketsContext.some(function (bucket) {
    return bucket.path.some(function (path) {
      if (path.test(resourcePath)) {
        match = bucket;
        return true;
      }
    });
  });

  return match;
}
