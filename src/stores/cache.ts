// create by elishell <75950346@qq.com>
import type { App } from "vue";

const _timeout = 5 * 1000;

const key = Symbol("key");
const val = Symbol("val");
const timeout = Symbol("timeout");
const ok = Symbol("ok");
const reject = Symbol("reject");
const reslove = Symbol("reslove");
const config = Symbol("config");

class Content {
  [prop: string]: any;
  constructor() {}
}

interface CacheConfig {
  content: Content;
  timeout: number;
}

class CacheItem {
  [key]: string;
  [val]: unknown;
  [timeout]: number;
  [ok] = false;
  [reject]: Array<(reason?: unknown) => void>;
  [reslove]: Array<(value: unknown) => void>;

  constructor(_key: string, _val: unknown, _t = _timeout) {
    this[key] = _key;
    this[val] = _val;
    this[timeout] = +new Date() + _t;

    this[reject] = [];
    this[reslove] = [];
  }

  get reject() {
    return this[reject];
  }

  get reslove() {
    return this[reslove];
  }

  get timeout() {
    return this[timeout];
  }

  get key() {
    return this[key];
  }

  set val(data: unknown) {
    this[ok] = true;
    this[val] = data;
  }

  get val() {
    return this[val];
  }

  toJSON() {
    return {
      key: this[key],
      val: this[val],
      timeout: this[timeout],
    };
  }

  isTimeout() {
    return this[timeout] < +new Date();
  }

  isOk() {
    return this[ok];
  }
}

class Cache {
  name: string;
  content: Content;
  timeout?: number;
  [config]: CacheConfig;

  constructor(
    name: string,
    { content = new Content(), timeout = _timeout }: Partial<CacheConfig> = {},
  ) {
    this.name = name;
    this.content = content;
    this[config] = {
      content,
      timeout,
    };
  }

  async get(key: string, callback: unknown, conf?: Partial<CacheConfig>) {
    const item = this.content[key] as CacheItem | undefined;
    // 没有 初始化
    if (item != null) {
      if (!item.isOk()) {
        return new Promise((resolve, rejectItem) => {
          item.reslove.push(resolve);
          item.reject.push(rejectItem);
        });
      }
      if (!item.isTimeout()) {
        return item.val;
      }
    }
    return this.feach(key, callback, {
      ...this[config],
      ...conf,
    });
  }

  /**
   * Populate a cache entry and settle every reader waiting for the same key.
   * @param {string} key Cache key.
   * @param {Function|Promise<unknown>|unknown} callback Loader or already available value.
   * @param {object} conf Entry timeout configuration.
   * @returns {Promise<unknown>} Loaded value; loader failures reject and evict the entry.
   */
  async feach(
    key: string,
    callback: unknown,
    conf: CacheConfig = this[config],
  ) {
    const oldItem = this.content[key] as CacheItem | undefined;
    const newItem = new CacheItem(key, null, conf.timeout);
    this.content[key] = newItem;
    const waitingItems = [oldItem, newItem].filter(
      (entry): entry is CacheItem => Boolean(entry),
    );
    try {
      const data =
        typeof callback === "function"
          ? await (callback as (k: string, c: CacheConfig) => unknown)(
              key,
              conf,
            )
          : await callback;
      newItem.val = data;
      for (const item of waitingItems) {
        for (const resolve of item.reslove) resolve(data);
      }
      return data;
    } catch (error) {
      if (this.content[key] === newItem) delete this.content[key];
      for (const item of waitingItems) {
        for (const rejectItem of item.reject) rejectItem(error);
      }
      throw error;
    } finally {
      for (const item of waitingItems) {
        item.reject.length = 0;
        item.reslove.length = 0;
      }
    }
  }

  clean(content = new Content()) {
    this.content = content;
  }
}

class CacheManager {
  content: Content;
  timeout: number;

  constructor(content = new Content(), timeout = _timeout) {
    this.content = content;
    this.timeout = timeout;
  }

  getCache(name: string, config?: Partial<CacheConfig>): Cache {
    let cache = this.content[name] as Cache | undefined;
    if (cache == null) {
      this.content[name] = cache = new Cache(name, {
        timeout: this.timeout,
        ...config,
      });
    } else if (config) {
      cache.timeout = config.timeout;
    }
    return cache;
  }

  delCache(name: string) {
    delete this.content[name];
  }

  clear() {
    this.content = new Content();
  }
}

declare global {
  interface Window {
    $CacheManager?: CacheManager;
  }
}

const $CacheManager = new CacheManager();

const install = (vm: App) => {
  if (vm.version.startsWith("3.")) {
    vm.config.globalProperties.$CacheManager = $CacheManager;
  } else {
    const legacyVm = vm as unknown as {
      prototype?: Record<string, unknown>;
    };
    if (legacyVm.prototype) {
      legacyVm.prototype.$CacheManager = $CacheManager;
    }
  }
};

if (typeof window !== "undefined") window.$CacheManager = $CacheManager;

export { $CacheManager, Cache, CacheManager, Content, install };
