async function main() {
    const homedir = require('os').homedir();
    const fs = require('fs');
    const {execFile} = require('child_process');
    const tmp = require('tmp');
    const {waitFile} = require('wait-file');

    console.log("\033[36mPWD: " + process.cwd() + "\033[0m");

    tmp.setGracefulCleanup();

    const execShFile = tmp.fileSync({
        mode: 0o744,
        prefix: 'helm-exec-',
        postfix: '.sh',
        discardDescriptor: true,
    });
    const dockerKubeConfigDir = process.cwd() + '/docker-kube-config-' + Math.random().toString(36).replace(/[^a-z]+/g, '').substr(0, 13);
    fs.mkdirSync(dockerKubeConfigDir, {
        mode: 0o777,
    });
    const dockerKubeConfig = dockerKubeConfigDir + '/config';
    const helmCacheDir = process.cwd() + '/helm-cache-' + Math.random().toString(36).replace(/[^a-z]+/g, '').substr(0, 13);
    fs.mkdirSync(helmCacheDir, {
        mode: 0o744,
    });

    const kubeConfigLocation = homedir + '/.kube/config';
    const kubeConfigExists = fs.existsSync(kubeConfigLocation);
    if (kubeConfigExists) {
        console.log("\033[36mExisting kubeconfig found, using that and ignoring input\033[0m");
    } else {
        console.log("\033[36mUsing kubeconfig from input\033[0m");
        fs.mkdirSync(homedir + '/.kube', {
            recursive: true,
        });
        fs.appendFileSync(
            kubeConfigLocation,
            "\r\n\r\n" + process.env.INPUT_KUBECONFIG + "\r\n\r\n",
            {
                mode: 0o644,
            }
        );
    }

    fs.writeFileSync(
        dockerKubeConfig,
        fs.readFileSync(kubeConfigLocation),
        {
            mode: 0o777,
        }
    );
    console.log("\033[36mPreparing helm execution\033[0m");
    fs.appendFileSync(
        execShFile.name,
        '#!/bin/bash\n' +
        ' \n' +
        'kubectl () {\n' +
        '    ' + dockerKubeConfigDir + '/kubectl "$@"\n' +
        '}\n' +
        'helm () {\n' +
        '    ' + dockerKubeConfigDir + '/helm "$@"\n' +
        '}\n' +
        ' \n' +
        'curl -s -o ' + dockerKubeConfigDir + ' "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/$(dpkg --print-architecture)/kubectl" 2>&1\n' +
        'curl -fsSL -o get_helm.sh https://raw.githubusercontent.com/helm/helm/master/scripts/get-helm-3 > /dev/null 2>&1\n' +
        'chmod 700 get_helm.sh > /dev/null 2>&1\n' +
        'HELM_INSTALL_DIR=' + dockerKubeConfigDir + ' ./get_helm.sh --version v3.8.1 > /dev/null 2>&1\n' +
        'rm ./get_helm.sh > /dev/null 2>&1\n' +
        ' \n' +
        process.env.INPUT_EXEC
    );

    await waitFile({
        resources: [
            kubeConfigLocation,
            execShFile.name,
        ],
    });

    try {
        console.log("\033[36mExecuting helm\033[0m");
        result = await new Promise((resolve, reject) => {
            const process = execFile(execShFile.name);
            process.stdout.on('data', console.log);
            process.stderr.on('data', console.log);
            let result = '';
            process.stdout.on('data', (data) => result += data);
            process.stderr.on('data', (data) => result += data);
            process.on('exit', (code) => {
                if (code === 0) {
                    resolve(result);
                } else {
                    reject(result);
                }
            });
        });
        console.log('::set-output name=helm_output::' + result.split('%').join('%25').split('\n').join('%0A').split('\r').join('%0D'));
    } catch (error) {
        process.exit(1);
    } finally {
        console.log("\033[36mCleaning up: \033[0m");
        fs.unlinkSync(execShFile.name);
        fs.unlinkSync(dockerKubeConfig);
        console.log("\033[36m  - exec ✅ \033[0m");
        if (!kubeConfigExists) {
            fs.unlinkSync(kubeConfigLocation);
            console.log("\033[36m  - kubeconfig ✅ \033[0m");
        }
    }
}

main();
