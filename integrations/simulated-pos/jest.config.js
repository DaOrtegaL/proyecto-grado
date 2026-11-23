module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testRegex: '.*\\.spec\\.ts$',
  testTimeout: 30000,
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: { module: 'commonjs', target: 'ES2022', lib: ['ES2022', 'DOM'], strict: true, esModuleInterop: true, types: ['node', 'jest'] } }] },
};
