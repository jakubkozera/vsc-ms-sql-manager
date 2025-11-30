// @ts-check
(function() {
    const vscode = acquireVsCodeApi();
    
    // Get form elements
    const form = document.getElementById('deployForm');
    const containerNameInput = document.getElementById('containerName');
    const portInput = document.getElementById('port');
    const networkSelect = document.getElementById('network');
    const memorySelect = document.getElementById('memory');
    const imageSelect = document.getElementById('image');
    const editionSelect = document.getElementById('edition');
    const collationSelect = document.getElementById('collation');
    const saPasswordInput = document.getElementById('saPassword');
    const acceptEulaCheckbox = document.getElementById('acceptEula');
    const togglePasswordBtn = document.getElementById('togglePasswordBtn');
    const generatePasswordBtn = document.getElementById('generatePasswordBtn');
    const deployBtn = document.getElementById('deployBtn');
    const testBtn = document.getElementById('testBtn');
    const progressSection = document.getElementById('progressSection');
    const progressMessage = document.getElementById('progressMessage');
    const resultSection = document.getElementById('resultSection');
    const resultContent = document.getElementById('resultContent');

    // Password requirement elements
    const reqLength = document.getElementById('req-length');
    const reqUppercase = document.getElementById('req-uppercase');
    const reqLowercase = document.getElementById('req-lowercase');
    const reqNumber = document.getElementById('req-number');
    const reqSpecial = document.getElementById('req-special');

    let deployedContainerId = null;

    // Initialize
    function init() {
        // Send ready message to backend
        vscode.postMessage({ command: 'ready' });

        // Set up event listeners
        saPasswordInput.addEventListener('input', validatePassword);
        acceptEulaCheckbox.addEventListener('change', validateForm);
        containerNameInput.addEventListener('input', validateForm);
        portInput.addEventListener('input', validateForm);
        imageSelect.addEventListener('change', updateSelectedImage);
        
        togglePasswordBtn.addEventListener('click', togglePassword);
        generatePasswordBtn.addEventListener('click', generatePassword);
        
        form.addEventListener('submit', handleDeploy);
        testBtn.addEventListener('click', handleTestConnection);

        // Initial validation
        validatePassword();
        validateForm();
    }

    // Update selected image display
    function updateSelectedImage() {
        const selectedImageSpan = document.getElementById('selectedImage');
        if (selectedImageSpan && imageSelect) {
            selectedImageSpan.textContent = imageSelect.value;
        }
    }

    // Validate password requirements
    function validatePassword() {
        const password = saPasswordInput.value;

        // Length check
        const hasLength = password.length >= 8;
        updateRequirement(reqLength, hasLength);

        // Uppercase check
        const hasUppercase = /[A-Z]/.test(password);
        updateRequirement(reqUppercase, hasUppercase);

        // Lowercase check
        const hasLowercase = /[a-z]/.test(password);
        updateRequirement(reqLowercase, hasLowercase);

        // Number check
        const hasNumber = /[0-9]/.test(password);
        updateRequirement(reqNumber, hasNumber);

        // Special character check
        const hasSpecial = /[^A-Za-z0-9]/.test(password);
        updateRequirement(reqSpecial, hasSpecial);

        validateForm();
    }

    // Update requirement UI
    function updateRequirement(element, isValid) {
        if (isValid) {
            element.classList.add('valid');
            element.querySelector('.icon').textContent = '✓';
        } else {
            element.classList.remove('valid');
            element.querySelector('.icon').textContent = '○';
        }
    }

    // Validate entire form
    function validateForm() {
        const password = saPasswordInput.value;
        const hasValidPassword = password.length >= 8 &&
                                 /[A-Z]/.test(password) &&
                                 /[a-z]/.test(password) &&
                                 /[0-9]/.test(password) &&
                                 /[^A-Za-z0-9]/.test(password);

        const containerName = containerNameInput.value.trim();
        const port = parseInt(portInput.value);
        const eulaAccepted = acceptEulaCheckbox.checked;

        const isValid = hasValidPassword && 
                       containerName.length > 0 && 
                       port > 0 && 
                       port <= 65535 && 
                       eulaAccepted;

        deployBtn.disabled = !isValid;
        
        // Enable test button if we have password and container was deployed
        testBtn.disabled = !hasValidPassword || !deployedContainerId;
    }

    // Toggle password visibility
    function togglePassword() {
        const type = saPasswordInput.type === 'password' ? 'text' : 'password';
        saPasswordInput.type = type;
        
        const icon = togglePasswordBtn.querySelector('svg');
        if (type === 'text') {
            // Show "eye-off" icon
            icon.innerHTML = `
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                <line x1="1" y1="1" x2="23" y2="23"></line>
            `;
        } else {
            // Show "eye" icon
            icon.innerHTML = `
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                <circle cx="12" cy="12" r="3"></circle>
            `;
        }
    }

    // Generate strong password
    function generatePassword() {
        vscode.postMessage({ command: 'generatePassword' });
    }

    // Handle deploy form submission
    function handleDeploy(e) {
        e.preventDefault();

        // Collect form data
        const options = {
            containerName: containerNameInput.value.trim(),
            saPassword: saPasswordInput.value,
            port: parseInt(portInput.value),
            image: imageSelect.value,
            edition: editionSelect.value,
            collation: collationSelect.value || undefined,
            network: networkSelect.value || undefined,
            memory: memorySelect.value || undefined,
            acceptEula: acceptEulaCheckbox.checked
        };

        // Show progress
        showProgress('Deploying container...');
        hideResult();
        deployBtn.disabled = true;
        testBtn.disabled = true;

        // Send deploy message
        vscode.postMessage({
            command: 'deploy',
            options: options
        });
    }

    // Handle test connection
    function handleTestConnection() {
        showProgress('Testing connection...');
        hideResult();

        vscode.postMessage({
            command: 'testConnection',
            host: 'localhost',
            port: parseInt(portInput.value),
            password: saPasswordInput.value
        });
    }

    // Show progress section
    function showProgress(message) {
        progressMessage.textContent = message;
        progressSection.style.display = 'block';
    }

    // Hide progress section
    function hideProgress() {
        progressSection.style.display = 'none';
    }

    // Show result
    function showResult(isSuccess, title, message) {
        resultSection.style.display = 'block';
        resultSection.className = 'result ' + (isSuccess ? 'success' : 'error');
        
        const icon = isSuccess 
            ? '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>'
            : '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>';

        resultContent.innerHTML = `
            <div class="result-title">
                ${icon}
                <span>${title}</span>
            </div>
            <div class="result-message">${message}</div>
        `;
    }

    // Hide result section
    function hideResult() {
        resultSection.style.display = 'none';
    }

    // Handle messages from extension
    window.addEventListener('message', event => {
        const message = event.data;

        switch (message.command) {
            case 'init':
                // Populate networks dropdown
                if (message.networks && message.networks.length > 0) {
                    networkSelect.innerHTML = '';
                    message.networks.forEach(network => {
                        const option = document.createElement('option');
                        option.value = network;
                        option.textContent = network;
                        if (network === 'bridge') {
                            option.textContent += ' (default)';
                            option.selected = true;
                        }
                        networkSelect.appendChild(option);
                    });
                }
                break;

            case 'deployResult':
                hideProgress();
                
                if (message.result.success) {
                    deployedContainerId = message.result.containerId;
                    showResult(
                        true,
                        'Deployment Successful!',
                        `Container deployed successfully with ID: ${message.result.containerId.substring(0, 12)}<br><br>` +
                        `<strong>Important:</strong> SQL Server is initializing. This may take 10-30 seconds.<br><br>` +
                        `You can now connect to SQL Server at:<br>` +
                        `<strong>Server:</strong> localhost,${portInput.value}<br>` +
                        `<strong>User:</strong> sa<br>` +
                        `<strong>Password:</strong> (your SA password)<br><br>` +
                        `Use "Test Connection" button to verify when SQL Server is ready.`
                    );
                    testBtn.disabled = false;
                } else {
                    showResult(
                        false,
                        'Deployment Failed',
                        message.result.error || 'Unknown error occurred'
                    );
                    deployBtn.disabled = false;
                }
                break;

            case 'testResult':
                hideProgress();
                
                if (message.result.success) {
                    showResult(
                        true,
                        'Connection Successful!',
                        'Successfully connected to SQL Server container.'
                    );
                } else {
                    showResult(
                        false,
                        'Connection Failed',
                        message.result.error || 'Could not connect to SQL Server.'
                    );
                }
                
                testBtn.disabled = false;
                deployBtn.disabled = false;
                break;

            case 'passwordGenerated':
                saPasswordInput.value = message.password;
                saPasswordInput.type = 'text';
                validatePassword();
                
                // Show notification
                showResult(
                    true,
                    'Password Generated',
                    'A strong password has been generated. Please copy and save it securely!'
                );
                
                setTimeout(() => {
                    hideResult();
                }, 5000);
                break;
        }
    });

    // Start
    init();
})();
