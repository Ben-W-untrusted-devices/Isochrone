import childProcess from 'node:child_process';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { syncBuiltinESMExports } from 'node:module';

const GUARD_MESSAGE = 'Automatic tests must not make network calls';
const BLOCKED_PROGRAMS = new Set([
  'aria2c',
  'curl',
  'ftp',
  'nc',
  'ping',
  'rsync',
  'scp',
  'sftp',
  'ssh',
  'telnet',
  'wget',
]);
const BLOCKED_GIT_SUBCOMMANDS = new Set(['clone', 'fetch', 'ls-remote', 'pull', 'push']);

function blocked(name) {
  return () => {
    throw new Error(`${GUARD_MESSAGE}: ${name}`);
  };
}

function toArgv(command, args = []) {
  if (Array.isArray(command)) {
    return command.map(String);
  }
  return [String(command), ...args.map(String)];
}

function assertSubprocessAllowed(command, args = []) {
  const argv = toArgv(command, args);
  const program = argv[0].split('/').at(-1);

  if (BLOCKED_PROGRAMS.has(program)) {
    throw new Error(`${GUARD_MESSAGE}: subprocess ${program}`);
  }
  if (program === 'git' && BLOCKED_GIT_SUBCOMMANDS.has(argv[1])) {
    throw new Error(`${GUARD_MESSAGE}: subprocess git ${argv[1]}`);
  }
}

globalThis.__ISOCHRONE_TESTS_NETWORK_GUARD_ACTIVE__ = true;
globalThis.fetch = async () => {
  throw new Error(`${GUARD_MESSAGE}: fetch`);
};

http.request = blocked('http.request');
http.get = blocked('http.get');
https.request = blocked('https.request');
https.get = blocked('https.get');
net.connect = blocked('net.connect');
net.createConnection = blocked('net.createConnection');
childProcess.execFile = ((original) => (file, args, options, callback) => {
  assertSubprocessAllowed(file, Array.isArray(args) ? args : []);
  return original(file, args, options, callback);
})(childProcess.execFile);
childProcess.execFileSync = ((original) => (file, args, options) => {
  assertSubprocessAllowed(file, Array.isArray(args) ? args : []);
  return original(file, args, options);
})(childProcess.execFileSync);
childProcess.exec = ((original) => (command, options, callback) => {
  assertSubprocessAllowed(command);
  return original(command, options, callback);
})(childProcess.exec);
childProcess.execSync = ((original) => (command, options) => {
  assertSubprocessAllowed(command);
  return original(command, options);
})(childProcess.execSync);
childProcess.spawn = ((original) => (command, args, options) => {
  assertSubprocessAllowed(command, Array.isArray(args) ? args : []);
  return original(command, args, options);
})(childProcess.spawn);
childProcess.spawnSync = ((original) => (command, args, options) => {
  assertSubprocessAllowed(command, Array.isArray(args) ? args : []);
  return original(command, args, options);
})(childProcess.spawnSync);

syncBuiltinESMExports();
