(async () => {
  try {
    const fs = require('fs');
    const packageJson = require('../package.json');
    const { generateSpec, generateRoutes } = require('@tsoa/cli');

    const { NODE_ENV } = process.env;
    const envVars = NODE_ENV
      ? JSON.parse(
          fs
            .readFileSync(
              fs.openSync(`.scaffoldly/${NODE_ENV}/env-vars.json`, 'r'),
            )
            .toString(),
        )
      : JSON.parse(
          fs
            .readFileSync(fs.openSync(`.scaffoldly/env-vars.json`, 'r'))
            .toString(),
        );

    console.log('Generating spec...');
    await generateSpec({
      basePath: `/${envVars['service-slug']}`,
      name: envVars['application-name'],
      version: packageJson.version,
      description: `To generate a JWT token, go to the <a href="${envVars['base-url']}/jwt.html" target="_blank">JWT Token Generator</a>`,
      entryFile: 'src/app.ts',
      noImplicitAdditionalProperties: 'throw-on-extras',
      controllerPathGlobs: ['src/api/api.ts', 'src/api/*-api.ts'],
      outputDirectory: 'src',
      specVersion: 3,
      securityDefinitions: {
        jwt: JSON.parse(
          JSON.stringify({
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
          }),
        ),
      },
    });

    console.log('Generating routes...');
    await generateRoutes({
      entryFile: 'src/app.ts',
      noImplicitAdditionalProperties: 'throw-on-extras',
      controllerPathGlobs: ['src/api/api.ts', 'src/api/*-api.ts'],
      routesDir: 'src',
      authenticationModule: 'src/auth.ts',
      noWriteIfUnchanged: true,
    });
  } catch (e: any) {
    console.warn('Error generating code', e.message);
  }
})();