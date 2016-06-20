import {keyValue} from './utils/storage';
import {
  keyApplicationCode, defaultPushwooshUrl,
  keyDefaultNotificationTitle, keyDefaultNotificationImage, keyDefaultNotificationUrl,
  defaultNotificationTitle, defaultNotificationImage, defaultNotificationUrl,
  keyWorkerSDKVersion
} from './constants';
import Logger from './classes/Logger';
import API from './classes/API';
import {getPushToken, generateHwid, getEncryptionKey, getBrowserType, getVersion} from './utils/functions';
import createDoApiFetch from './utils/createDoApiFetch';

// console.log(self.location);

class WorkerRunner {
  constructor() {
    this.pushwooshUrl = defaultPushwooshUrl;
    this.logger = new Logger('debug');
  }

  getApplicationCode() {
    return keyValue.get(keyApplicationCode).then(code => {
      if (!code) {
        throw new Error('no code');
      }
      return code;
    });
  }

  initApi() {
    if (this.api) {
      return Promise.resolve();
    }
    return Promise.all([
      self.registration.pushManager.getSubscription(),
      this.getApplicationCode()
    ])
      .then(([subscription, applicationCode]) => {
        const pushToken = getPushToken(subscription);
        const hwid = generateHwid(applicationCode, pushToken);
        const encryptionKey = getEncryptionKey(subscription);

        this.api = new API({
          doPushwooshApiMethod: createDoApiFetch(this.pushwooshUrl, this.logger),
          applicationCode: applicationCode,
          hwid: hwid,
          pushToken: pushToken,
          encryptionKey: encryptionKey
        });
      });
  }

  showMessage(result) {
    this.logger.info('showMessage', result);
    const {notification} = result;

    return Promise.all([
      keyValue.get(keyDefaultNotificationTitle),
      keyValue.get(keyDefaultNotificationImage),
      keyValue.get(keyDefaultNotificationUrl)
    ]).then(([userTitle, userImage, userUrl]) => {
      const title = notification.chromeTitle || userTitle || defaultNotificationTitle;
      const message = notification.content;
      const icon = notification.chromeIcon || userImage || defaultNotificationImage;
      const messageHash = notification.messageHash;
      const url = notification.url || userUrl || defaultNotificationUrl;


      const tag = {
        url: url,
        messageHash: messageHash
      };
      return self.registration.showNotification(title, {
        body: message,
        icon: icon,
        tag: JSON.stringify(tag)
      });
    });
  }

  push(event) {
    this.logger.info('onPush', event);
    event.waitUntil(this.initApi().then(() => {
      return this.api.callAPI('getLastMessage', {device_type: getBrowserType()}).then(lastMessage => {
        return this.showMessage(lastMessage);
      });
    }));
  }

  click(event) {
    this.logger.info('onClick', event);
    let {tag} = event.notification;
    tag = JSON.parse(tag);
    event.waitUntil(Promise.resolve().then(() => {
      return this.api.pushStat(tag.messageHash);
    }));
    event.notification.close();
    return clients.openWindow(tag.url); // eslint-disable-line no-undef
  }

  install(event) {
    event.waitUntil(keyValue.set(keyWorkerSDKVersion, getVersion()).then(() => self.skipWaiting()));
  }

  activate(event) {
    return event.waitUntil(caches.keys().then(cacheNames => {
      return Promise.all(cacheNames.map(cacheName => caches.delete(cacheName)));
    }).then(self.clients.claim()));
  }
}


const runner = new WorkerRunner();

self.addEventListener('push', (event) => runner.push(event));
self.addEventListener('notificationclick', (event) => runner.click(event));
self.addEventListener('install', (event) => runner.install(event));
self.addEventListener('activate', (event) => runner.activate(event));

self.Pushwoosh = runner;
