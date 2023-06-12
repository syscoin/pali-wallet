const PLUGIN_NAME = 'SplitChunksPlugin';

function regExpQuote(str) {
  return (str + '').replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, '\\$&');
}

class SplitChunksPlugin {
  constructor(options) {
    this.buckets = options.buckets || [];
    this.ignore = options.ignore || [];
    this.ignoreChunks = options.ignoreChunks || [];
    this.manifestName = options.manifestName || 'manifest';
  }

  apply(compiler) {
    const { hooks } = compiler;

    if (!Array.isArray(this.ignore)) {
      this.ignore = [this.ignore];
    }

    if (!Array.isArray(this.ignoreChunks)) {
      this.ignoreChunks = [this.ignoreChunks];
    }

    this.ignore = this.ignore.map(function (item) {
      if (item instanceof RegExp) {
        return item;
      }

      return new RegExp('^' + regExpQuote(item));
    });

    this.buckets = this.buckets.slice(0).map(function (bucket) {
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

    if (hooks) {
      hooks.compilation.tap(PLUGIN_NAME, (compilation) => {
        var extraChunks = {};

        function bucketToChunk(bucket) {
          return extraChunks[bucket.name];
        }

        compilation.hooks.processAssets.tap(PLUGIN_NAME, (chunks, callback) => {
          var addChunk = compilation.addChunk.bind(compilation);

          var entryChunks = Array.from(chunks)
            .filter((chunk) => {
              return (
                chunk.canBeInitial() &&
                chunk.name &&
                !this.ignoreChunks.includes(chunk.name)
              );
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

          var notEmptyBucketChunks = this.buckets
            .map(bucketToChunk)
            .filter(Boolean);

          var manifestChunk = addChunk(this.manifestName);
          manifestChunk.chunks = notEmptyBucketChunks.concat(entryChunks);

          manifestChunk.chunks.forEach(function (chunk) {
            chunk.setRuntimeChunk(manifestChunk);
            Array.from(
              compilation.chunkGraph.getChunkModulesIterable(chunk)
            ).forEach(function (entry) {
              compilation.entrypoints.get(entry.name).insertChunk(chunk);
            });
          });
        });
      });
    }
  }
}

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

module.exports = SplitChunksPlugin;
