const vscode = acquireVsCodeApi();
let selectedColor = '';
let selectedIcon = 'folder';
let selectedCustomIconId = null;
let customIcons = [];

// Load custom icons from extension
vscode.postMessage({ command: 'loadCustomIcons' });

// Listen for messages from extension
window.addEventListener('message', event => {
    const message = event.data;
    switch (message.command) {
        case 'customIconsLoaded':
            customIcons = message.icons;
            renderCustomIcons();
            initializeForm();
            break;
        case 'customIconAdded':
            customIcons = message.icons;
            renderCustomIcons();
            break;
        case 'customIconDeleted':
            customIcons = message.icons;
            renderCustomIcons();
            
            // If the deleted icon was selected, reset to default
            if (message.deletedIconId && selectedCustomIconId === message.deletedIconId) {
                selectedIcon = 'folder';
                selectedCustomIconId = null;
                selectedColor = '#0078D4';
                document.getElementById('colorPickerGroup').style.display = 'block';
                
                const firstIcon = document.querySelector('.icon-option[data-icon="folder"]');
                if (firstIcon) {
                    document.querySelectorAll('.icon-option').forEach(opt => opt.classList.remove('selected'));
                    firstIcon.classList.add('selected');
                }
                
                updatePreview();
            }
            break;
    }
});

function initializeForm() {
    // Initialize form if editing
    if (editingGroup) {
        document.getElementById('groupName').value = editingGroup.name;
        document.getElementById('groupDescription').value = editingGroup.description || '';
        
        if (editingGroup.iconType === 'custom' && editingGroup.customIconId) {
            // Custom icon selected
            selectedIcon = 'custom';
            selectedCustomIconId = editingGroup.customIconId;
            selectedColor = ''; // No color for custom icons
            
            // Select the custom icon
            const customIconOption = document.querySelector('[data-custom-icon-id="' + editingGroup.customIconId + '"]');
            if (customIconOption) {
                customIconOption.classList.add('selected');
            }
            
            // Hide color picker
            document.getElementById('colorPickerGroup').style.display = 'none';
        } else {
            // Regular icon with color
            selectedColor = editingGroup.color;
            selectedIcon = editingGroup.iconType || 'folder';
            
            // Select the icon
            const iconOption = document.querySelector('[data-icon="' + selectedIcon + '"]');
            if (iconOption) {
                iconOption.classList.add('selected');
            }
            
            // Select the color
            const colorOption = document.querySelector('[data-color="' + editingGroup.color + '"]');
            if (colorOption) {
                colorOption.classList.add('selected');
            }
            
            // Initialize custom color if needed
            initializeCustomColor();
        }
        
        updatePreview();
    } else {
        // Default to first icon
        const firstIcon = document.querySelector('.icon-option');
        if (firstIcon) {
            firstIcon.classList.add('selected');
        }
    }
}

function renderCustomIcons() {
    const iconPicker = document.getElementById('iconPicker');
    const addButton = iconPicker.querySelector('.add-custom-icon');
    
    // Remove existing custom icons
    const existingCustomIcons = iconPicker.querySelectorAll('.icon-option[data-custom-icon-id]');
    existingCustomIcons.forEach(icon => icon.remove());
    
    // Add custom icons before the add button
    customIcons.forEach(icon => {
        const iconDiv = document.createElement('div');
        iconDiv.className = 'icon-option custom-icon-option-item';
        iconDiv.setAttribute('data-icon', 'custom');
        iconDiv.setAttribute('data-custom-icon-id', icon.id);
        iconDiv.title = icon.name;
        
        // Parse and resize SVG
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = icon.svgContent;
        const svgElement = tempDiv.querySelector('svg');
        if (svgElement) {
            svgElement.setAttribute('width', '32');
            svgElement.setAttribute('height', '32');
            iconDiv.appendChild(svgElement);
        } else {
            iconDiv.innerHTML = icon.svgContent;
        }
        
        // Add delete button (hidden by default, shown on hover)
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'delete-custom-icon';
        deleteBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>';
        deleteBtn.title = 'Delete custom icon';
        deleteBtn.onclick = (e) => {
            e.stopPropagation();
            deleteCustomIcon(icon.id);
        };
        iconDiv.appendChild(deleteBtn);
        
        // Add click handler for selection
        iconDiv.addEventListener('click', () => {
            document.querySelectorAll('.icon-option').forEach(opt => opt.classList.remove('selected'));
            iconDiv.classList.add('selected');
            selectedIcon = 'custom';
            selectedCustomIconId = icon.id;
            selectedColor = ''; // No color for custom icons
            
            // Hide color picker when custom icon is selected
            document.getElementById('colorPickerGroup').style.display = 'none';
            
            updatePreview();
        });
        
        iconPicker.insertBefore(iconDiv, addButton);
    });
}

function deleteCustomIcon(iconId) {
    // Ask extension to show confirmation dialog
    vscode.postMessage({
        command: 'confirmDeleteCustomIcon',
        iconId: iconId
    });
}

// Icon selection for default icons
document.querySelectorAll('.icon-option:not(.add-custom-icon)').forEach(option => {
    if (!option.hasAttribute('data-custom-icon-id')) {
        option.addEventListener('click', () => {
            document.querySelectorAll('.icon-option').forEach(opt => opt.classList.remove('selected'));
            option.classList.add('selected');
            selectedIcon = option.dataset.icon;
            selectedCustomIconId = null;
            
            // Show color picker when non-custom icon is selected
            document.getElementById('colorPickerGroup').style.display = 'block';
            
            updatePreview();
        });
    }
});

// Add custom icon button
document.querySelector('.add-custom-icon').addEventListener('click', async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.svg';
    
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        const reader = new FileReader();
        reader.onload = async (event) => {
            const svgContent = event.target.result;
            
            // Basic SVG validation
            if (!svgContent.includes('<svg') || !svgContent.includes('</svg>')) {
                vscode.postMessage({
                    command: 'showError',
                    message: 'Invalid SVG file. Please select a valid SVG file.'
                });
                return;
            }
            
            // Extract filename without extension
            const iconName = file.name.replace('.svg', '');
            
            // Send to extension to save
            vscode.postMessage({
                command: 'addCustomIcon',
                icon: {
                    id: 'custom_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
                    name: iconName,
                    svgContent: svgContent
                }
            });
        };
        
        reader.readAsText(file);
    };
    
    input.click();
});

// Color selection for preset colors
document.querySelectorAll('.color-option').forEach(option => {
    // Skip the custom color input
    if (option.classList.contains('custom-color-option')) {
        return;
    }
    option.addEventListener('click', () => {
        document.querySelectorAll('.color-option').forEach(opt => opt.classList.remove('selected'));
        option.classList.add('selected');
        selectedColor = option.dataset.color;
        // Reset custom color input
        document.getElementById('customColorInput').value = '';
        updatePreview();
    });
});

// Custom color picker logic
const customColorInput = document.getElementById('customColorInput');
customColorInput.addEventListener('input', (e) => {
    const color = e.target.value;
    selectedColor = color;
    // Remove selection from all preset options
    document.querySelectorAll('.color-option').forEach(opt => opt.classList.remove('selected'));
    // Highlight the custom color box
    customColorInput.parentElement.classList.add('selected');
    updatePreview();
});

// Initialize custom color if needed (called after custom icons loaded)
function initializeCustomColor() {
    if (editingGroup && editingGroup.color && editingGroup.iconType !== 'custom') {
        const presetColors = ["#A16340","#7F0000","#914576","#6E9859","#5F82A5","#4452A6","#6A6599","#515151"];
        if (!presetColors.includes(editingGroup.color)) {
            customColorInput.value = editingGroup.color;
            customColorInput.parentElement.classList.add('selected');
        }
    }
}

// Form submission
document.getElementById('serverGroupForm').addEventListener('submit', (e) => {
    e.preventDefault();
    
    const formData = new FormData(e.target);
    const groupData = {
        id: editingGroup ? editingGroup.id : generateId(),
        name: formData.get('name'),
        description: formData.get('description'),
        iconType: selectedIcon
    };
    
    // Add color or customIconId depending on icon type
    if (selectedIcon === 'custom') {
        groupData.customIconId = selectedCustomIconId;
        if (!groupData.customIconId) {
            vscode.postMessage({
                command: 'showError',
                message: 'Please select a custom icon'
            });
            return;
        }
    } else {
        groupData.color = selectedColor;
        if (!groupData.color) {
            vscode.postMessage({
                command: 'showError',
                message: 'Please select a color'
            });
            return;
        }
    }
    
    if (!groupData.name || !groupData.iconType) {
        vscode.postMessage({
            command: 'showError',
            message: 'Please fill in all required fields'
        });
        return;
    }
    
    vscode.postMessage({
        command: 'submit',
        data: groupData
    });
});

function cancelForm() {
    vscode.postMessage({ command: 'cancel' });
}

function updatePreview() {
    const nameInput = document.getElementById('groupName');
    const preview = document.getElementById('preview');
    const previewIcon = document.getElementById('previewIcon');
    const previewName = document.getElementById('previewName');
    
    const hasValidIcon = selectedIcon && (selectedIcon === 'custom' ? selectedCustomIconId : selectedColor);
    
    if (nameInput.value && hasValidIcon) {
        preview.style.display = 'block';
        previewName.textContent = nameInput.value;
        
        previewIcon.innerHTML = '';
        
        if (selectedIcon === 'custom' && selectedCustomIconId) {
            // Get custom icon SVG
            const customIcon = customIcons.find(icon => icon.id === selectedCustomIconId);
            if (customIcon) {
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = customIcon.svgContent;
                const svgElement = tempDiv.querySelector('svg');
                if (svgElement) {
                    const svgClone = svgElement.cloneNode(true);
                    svgClone.setAttribute('width', '16');
                    svgClone.setAttribute('height', '16');
                    previewIcon.appendChild(svgClone);
                }
            }
        } else {
            // Get the SVG from the selected default icon
            const selectedIconElement = document.querySelector('.icon-option[data-icon="' + selectedIcon + '"] svg');
            if (selectedIconElement) {
                const svgClone = selectedIconElement.cloneNode(true);
                svgClone.setAttribute('width', '16');
                svgClone.setAttribute('height', '16');
                svgClone.setAttribute('stroke', selectedColor);
                previewIcon.appendChild(svgClone);
            }
        }
    } else {
        preview.style.display = 'none';
    }
}

function generateId() {
    return 'group_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

// Update preview on name change
document.getElementById('groupName').addEventListener('input', updatePreview);
