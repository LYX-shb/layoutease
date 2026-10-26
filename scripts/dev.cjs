const { spawn } = require('node:child_process');
const { createServer } = require('vite');
const electronExecutable = require('electron');

async function main() {
  const server = await createServer({
    server: { host: '127.0.0.1', port: 0, strictPort: true },
  });

  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === 'string') {
    await server.close();
    throw new Error('无法读取 Vite 开发服务器地址');
  }

  const devUrl = `http://127.0.0.1:${address.port}`;
  server.printUrls();
  console.log(`Electron 预览地址：${devUrl}`);
  const electronEnvironment = { ...process.env, VITE_DEV_SERVER_URL: devUrl };
  delete electronEnvironment.ELECTRON_RUN_AS_NODE;
  const electron = spawn(electronExecutable, ['.'], {
    stdio: 'inherit',
    env: electronEnvironment,
  });

  let closing = false;
  const closeServer = async () => {
    if (closing) return;
    closing = true;
    await server.close();
  };

  electron.on('error', async (error) => {
    console.error('无法启动 Electron：', error.message);
    await closeServer();
    process.exitCode = 1;
  });
  electron.on('exit', async (code, signal) => {
    await closeServer();
    process.exitCode = signal ? 1 : (code ?? 1);
  });

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => {
      electron.kill(signal);
      void closeServer();
    });
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
