import 'reflect-metadata';
import {
  RPCAdapterRedis,
  RPCAgnostic,
  AgnosticRPCOptions,
  Meter,
  RedisFactory,
  Logger,
  AppConfig,
  RPCAdapter,
  MeterFacade,
  RPCAppStatus,
  MethodRegistration,
} from '@rockstat/rock-me-ts';
import {
  ModuleConfig
} from '@app/types';

import * as path from 'path';
import { readFileSync } from 'fs';
import * as yaml from 'js-yaml';


import {
  SERVICE_DIRECTOR,
  METHOD_IAMALIVE,
  METHOD_STATUS,
  ENRICH
} from '@app/constants';

import { Reader as MMReader, ReaderModel, City } from '@maxmind/geoip2-node';
import { IP2Location } from "ip2location-nodejs";
// import { LRUCache } from 'lru-cache';
// import LRU_TTL from 'lru-ttl-cache';

import { UAParser } from 'ua-parser-js';
import * as TTLCache from '@isaacs/ttlcache';

const uapcCache = new TTLCache<string, { [k: string]: any }>({ max: 10000, ttl: 30 * 60 * 1000 })
const ip2lCache = new TTLCache<string, { [k: string]: any }>({ max: 10000, ttl: 30 * 60 * 1000 })
const uapCache = new TTLCache<string, { [k: string]: any }>({ max: 10000, ttl: 30 * 60 * 1000 })

// const lruUAPC = new QLRU({ maxSize: 50000, maxAge: 60 * 60 * 1000 });


const mm_options = {
  cache: { max: 20000 }
  // you can use options like `cache` or `watchForUpdates`
};


import { loadDB } from './helpers'
import { any } from 'bluebird';

const readYAML = (fileName: string) => {
  var file = path.join(__dirname, fileName);
  var data = readFileSync(file, 'utf8');
  return yaml.load(data);
}


const refImpl = require('uap-ref-impl')(readYAML('../node_modules/uap-core/regexes.yaml'))

const uapcVersionKeys = ['major', 'minor', 'patch'];
function uapcVersion(data: { [k: string]: any }) {
  const res = []
  if (typeof data !== 'object') return;

  for (const k of uapcVersionKeys) {
    const v = data[k];
    if (v === undefined || v === null) break;
    res.push(v || '0');
  }

  return res.join('.');
}

function uapс(ua: string) {

  const c = uapcCache.get(ua);
  if (c) {
    return c;
  }

  const res: { [k: string]: any } = {};
  const parsed = refImpl.parse(ua);

  // console.log(parsed);

  if (typeof parsed == 'object') {

    // res['is_bot'] = false;
    // res['is_webview'] = false;

    if (typeof parsed['ua'] == 'object') {
      res['browser_family'] = parsed['ua']['family'];
      res['browser_version'] = uapcVersion(parsed['ua']);
      if (typeof res['browser_family'] === 'string') {
        res['is_webview'] = !!res['browser_family'].toLocaleLowerCase().includes('webview');
      }
    }
    if (typeof parsed['os'] == 'object') {
      res['os_family'] = parsed['os']['family'];
      res['os_version'] = uapcVersion(parsed['os']);
    }
    if (typeof parsed['browser'] == 'object') {
      res['browser_family'] = parsed['browser']['family']
    }

    parsed.device = parsed.device || {};
    if (typeof parsed['device'] == 'object') {
      res['device_family'] = parsed['device']['family']
      res['device_brand'] = parsed['device']['brand']
      res['device_model'] = parsed['device']['model']
      if (parsed['device']['family'] === 'Spider') {
        res['is_bot'] = true;
      }
    }
  }
  uapcCache.set(ua, res);

  return res;
}




// const tests = [
//   'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Mobile/15E148 Safari/604.1',
//   'Mozilla/5.0 (Linux; Android 14; 23021RAAEG Build/UKQ1.230917.001) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0.6367.172 Mobile Safari/537.36',
//   'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36',
//   'Mozilla/5.0 (Linux; U; Android 14; en-gb; RMX3750 Build/UKQ1.230924.001) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/111.0.5563.116 Mobile Safari/537.36 PHX/15.4',
//   'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
//   'Mozilla/5.0 (compatible; YandexAccessibilityBot/3.0; +http://yandex.com/bots)',
//   'Mozilla/5.0 (compatible; YandexForDomain/1.0; +http://yandex.com/bots)',
//   'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Googlebot/2.1; +http://www.google.com/bot.html) Chrome/W.X.Y.Z Safari/537.36',
// ]

// for (let ua of tests) {
//   console.log(uapс(ua));
// }



/**
 * Dependency container
 */
export class Deps {
  log: Logger;
  config: AppConfig<ModuleConfig>;
  meter: Meter;
  rpc: RPCAgnostic;
  rpcAdaptor: RPCAdapter;
  redisFactory: RedisFactory;
  constructor(obj: { [k: string]: any } = {}) {
    Object.assign(this, obj);
  }
}


const handleCity = (city: City) => {
  const res: { [k: string]: string } = {}

  if (city) {
    if (city.country) {
      res['country_en'] = city.country.names.en;
      res['country_iso'] = city.country.isoCode;
    }

    if (city.city) {
      res['city_en'] = city.city.names.en;
    }

    if (city.subdivisions && city.subdivisions.length > 0) {
      res['region_en'] = city.subdivisions[0].names.en;
      res['region_iso'] = city.subdivisions[0].isoCode;
    }
  }

  return res;
}


/**
 * Main application. Contains main logic
 */
export class AppServer {
  log: Logger;
  deps: Deps;
  name: string;
  service_group: string;
  rpcAdaptor: RPCAdapter;
  rpc: RPCAgnostic;
  appStarted: Date = new Date();
  meter: MeterFacade;

  enrichers: Array<{ 'method': string, keys: string[], props: { [k: string]: string } }> = new Array();

  registerEnricher = (method: string, keys: string[], props: { [k: string]: string }): void => {
    this.enrichers.push({
      method, keys, props
    })
  }

  mmReader: ReaderModel;
  ip2lReader: IP2Location;
  rstDB: Map<string, any>;



  constructor() {
    const config = new AppConfig<ModuleConfig>();
    const log = new Logger(config.log);
    const meter = new Meter(config.meter);
    this.meter = meter;
    this.name = config.rpc.name;
    this.service_group = config.rpc.service_group || 'unknown';
    this.deps = new Deps({
      log,
      config,
      meter
    });
    this.log = log.for(this);
    this.log.info('Starting service');

    if (this.service_group == 'mmgeo') {
      this.log.info('Starting with MMGEO DB')
      const dbBuffer = readFileSync('./data/GeoLite2-City.mmdb');
      this.mmReader = MMReader.openBuffer(dbBuffer);
    }
    if (this.service_group == 'rst') {
      this.log.info('Starting with RST DB')
      this.rstDB = loadDB('./data/2024-05-19_feed');
    }

    if (this.service_group == 'ip2lgeo') {
      this.log.info('Starting with IP2L DB')
      this.ip2lReader = new IP2Location();
      this.ip2lReader.open("./data/IPV6-COUNTRY-REGION-CITY.BIN");
    }

    //   const test_uas = [
    //   "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
    //   "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36",
    //   "Mozilla/5.0 (Linux; Android 11; SM-M022G Build/RP1A.200720.012; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0.6367.172 Mobile Safari/537.36",
    //   "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/124.0.6367.111 Mobile/15E148 Safari/604.1",
    //   "Mozilla/5.0 (iPhone; CPU iPhone OS 17_1_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 YaBrowser/24.4.3.667.10 YaApp_iOS/2404.3 YaApp_iOS_Browser/2404.3 Safari/604.1 SA/3",
    //   "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36"

    // ]

    // # List of possible values for `device.type`: mobile, tablet, smarttv, console, wearable, embedded
    // if (this.service_group == 'uap'){
    //   for(let ua of test_uas){
    //     let ua_data = UAParser(ua);

    //     const result = {
    //       browser_name: ua_data.browser.name,
    //       browser_version: ua_data.browser.version,
    //       engine_name: ua_data.engine.name,
    //       engine_version: ua_data.engine.version,
    //       device_type: ua_data.device.type,
    //       device_vendor: ua_data.device.vendor,
    //       device_model: ua_data.device.model,
    //       os_name: ua_data.os.name,
    //       os_version: ua_data.os.version
    //     }
    //     console.log(result)
    //   }

    // }

    try {

      // setup Redis
      const redisFactory = this.deps.redisFactory = new RedisFactory({ log, meter, ...config.redis });
      // Setup RPC
      const channels = [ENRICH, this.name]
      const rpcOptions: AgnosticRPCOptions = { channels, redisFactory, log, meter, ...config.rpc }
      this.rpcAdaptor = this.deps.rpcAdaptor = new RPCAdapterRedis(rpcOptions);
      this.rpc = this.deps.rpc = new RPCAgnostic(rpcOptions);
      this.rpc.setup(this.rpcAdaptor);
    } catch (exc) {
      this.log.error(exc);
      this.stop();
    }
    this.setup()
      .then((() => {
        this.log.info('Setup completed');
      }))
      .catch(exc => {
        this.log.error(exc);
        this.stop();
      });
  }

  async status(params: object) {
    const appUptime = Number(new Date()) - Number(this.appStarted);
    const result: RPCAppStatus = {
      name: this.name,
      app_state: "running",
      app_started: Number(this.appStarted),
      app_uptime: appUptime,
      register: []
    };

    for (let e of this.enrichers) {
      let reg: MethodRegistration = {
        // service: this.name,
        method: e.method,
        role: 'enricher',
        options: {
          keys: e.keys,
          props: e.props
        }
      }

      result.register.push(reg);
    }


    return result;
  }

  async handle({ ip, ua }: { ip: string, ua: string }) {
    if (this.service_group == 'mmgeo') {
      // check ip not v6
      if (!ip.includes(':')) {
        try {
          const s = this.mmReader.city(ip);
          return handleCity(s)
        } catch (e) {
          this.log.error(e, 'mmgeo ex')
        }
      }
    }

    if (this.service_group == 'rst') {
      return this.rstDB.get(ip) || {}
    }

    if (this.service_group == 'ip2lgeo') {
      // return await this.ip2lGetter.get(ip);
      // const getData = (key:string) => {
      let ad = this.ip2lReader.getAll(ip);
      let result = {
        country_en: ad.countryLong,
        country_iso: ad.countryShort,
        city_en: ad.city,
        region_en: ad.region,
      }
      return result;
      // }
    }

    if (this.service_group == 'uap') {
      // return await this.ip2lGetter.get(ip);
      // const getData = (key:string) => {

      // # List of possible values for `device.type`: mobile, tablet, smarttv, console, wearable, embedded
      const c = uapCache.get(ua);
      if (c) {
        return c;
      }
      let ua_data = UAParser(ua);

      const result = {
        browser_name: ua_data.browser.name,
        browser_version: ua_data.browser.version,
        engine_name: ua_data.engine.name,
        engine_version: ua_data.engine.version,
        device_type: ua_data.device.type,
        device_vendor: ua_data.device.vendor,
        device_model: ua_data.device.model,
        os_name: ua_data.os.name,
        os_version: ua_data.os.version
      }

      uapCache.set(ua, result);

      return result;

    }

    if (this.service_group == 'uapc') {
      try {
        return uapс(ua);
      } catch (e) {
        console.error(e);
      }
    }

    return {}
  }

  /**
   * Required remote functuins
   */
  async setup() {
    this.rpc.register(ENRICH, this.handle.bind(this));
    this.registerEnricher(ENRICH, ['in.gen.track'], { ip: 'td.ip', ua: 'td.ua' })
    this.rpc.register(METHOD_STATUS, () => this.status({}));

    const aliver = () => {
      this.meter.tick(`band.${this.name}.alive`)
      // this.rpc.notify(SERVICE_DIRECTOR, METHOD_IAMALIVE, { name: this.name, status: this.status({})})
      Promise.all([this.rpc.notify(SERVICE_DIRECTOR, METHOD_IAMALIVE, { name: this.name })]);
    };
    setTimeout(aliver, 500);
    setInterval(aliver, 9 * 1000);


    // this.log.info(, 'ip2l result')
  }

  /**
   * Graceful stot
   */
  private stop() {
    this.log.info('Stopping...');
    process.exit(0)
  }

  /**
   * Sinals listening
   */
  private attachSignals() {
    // Handles normal process termination.
    process.on('exit', () => this.stop());
    // Handles `Ctrl+C`.
    process.on('SIGINT', () => this.stop());
    // Handles `kill pid`.
    process.on('SIGTERM', () => this.stop());
  }
}

export const appServer = new AppServer();
