import { rimraf, writeMultipleFiles } from '../../utils/fs';
import { findFreePort } from '../../utils/network';
import { execAndWaitForOutputToMatch, killAllProcesses, ng } from '../../utils/process';
import { useCIChrome, useCIDefaults } from '../../utils/project';

export default async function () {
  // forcibly remove in case another test doesn't clean itself up
  await rimraf('node_modules/@angular/ssr');

  await ng('generate', 'app', 'test-project-two', '--standalone', '--skip-install');

  await ng('generate', 'e2e', '--related-app-name=test-project-two');
  // Setup testing to use CI Chrome.
  await useCIChrome('test-project-two', 'projects/test-project-two/e2e/');
  await useCIDefaults('test-project-two');

  await ng('add', '@angular/ssr', '--skip-confirmation', '--project=test-project-two');

  await writeMultipleFiles({
    'projects/test-project-two/src/styles.css': `* { color: #000 }`,
    'projects/test-project-two/src/main.ts': `import { bootstrapApplication } from '@angular/platform-browser';
      import { AppComponent } from './app/app.component';
      import { appConfig } from './app/app.config';

      (window as any)['doBootstrap'] = () => {
        bootstrapApplication(AppComponent, appConfig).catch((err) => console.error(err));
      };
      `,
    'projects/test-project-two/e2e/src/app.e2e-spec.ts': `
      import { browser, by, element } from 'protractor';
      import * as webdriver from 'selenium-webdriver';

      function verifyNoBrowserErrors() {
        return browser
          .manage()
          .logs()
          .get('browser')
          .then(function (browserLog: any[]) {
            const errors: any[] = [];
            browserLog.filter((logEntry) => {
              const msg = logEntry.message;
              console.log('>> ' + msg);
              if (logEntry.level.value >= webdriver.logging.Level.INFO.value) {
                errors.push(msg);
              }
            });
            expect(errors).toEqual([]);
          });
      }

      describe('Hello world E2E Tests', () => {
        beforeAll(async () => {
          await browser.waitForAngularEnabled(false);
        });

        it('should display: Welcome', async () => {
          // Load the page without waiting for Angular since it is not bootstrapped automatically.
          await browser.driver.get(browser.baseUrl);

          const style = await browser.driver.findElement(by.css('style[ng-app-id="ng"]'));
          expect(await style.getText()).not.toBeNull();

          // Test the contents from the server.
          const serverDiv = await browser.driver.findElement(by.css('div'));
          expect(await serverDiv.getText()).toMatch('Welcome');

          // Bootstrap the client side app.
          await browser.executeScript('doBootstrap()');

          // Retest the contents after the client bootstraps.
          expect(await element(by.css('div')).getText()).toMatch('Welcome');

          // Make sure the server styles got replaced by client side ones.
          expect(await element(by.css('style[ng-app-id="ng"]')).isPresent()).toBeFalsy();
          expect(await element(by.css('style')).getText()).toMatch('');

          // Make sure there were no client side errors.
          await verifyNoBrowserErrors();
        });

        it('stylesheets should be configured to load asynchronously', async () => {
          // Load the page without waiting for Angular since it is not bootstrapped automatically.
          await browser.driver.get(browser.baseUrl);

          // Test the contents from the server.
          const styleTag = await browser.driver.findElement(by.css('link[rel="stylesheet"]'));
          expect(await styleTag.getAttribute('media')).toMatch('all');

          // Make sure there were no client side errors.
          await verifyNoBrowserErrors();
        });
      });
      `,
  });

  async function ngDevSsr(): Promise<number> {
    const port = await findFreePort();

    await execAndWaitForOutputToMatch(
      'ng',
      ['run', 'test-project-two:serve-ssr:production', '--port', String(port)],
      /Compiled successfully\./,
    );

    return port;
  }

  try {
    const port = await ngDevSsr();
    await ng(
      'e2e',
      'test-project-two',
      `--base-url=http://localhost:${port}`,
      '--dev-server-target=',
    );
  } finally {
    await killAllProcesses();
  }
}
