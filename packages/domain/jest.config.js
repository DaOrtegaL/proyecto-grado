module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testRegex: '.*\\.spec\\.ts$',
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: { module: 'commonjs', target: 'ES2022', strict: true, esModuleInterop: true, types: ['node', 'jest'] } }] },
};
