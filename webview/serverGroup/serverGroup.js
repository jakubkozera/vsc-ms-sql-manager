const vscode = acquireVsCodeApi();
let selectedColor = '';
let selectedIcon = 'folder';

// Initialize form if editing
if (editingGroup) {
    document.getElementById('groupName').value = editingGroup.name;
    document.getElementById('groupDescription').value = editingGroup.description || '';
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
        updatePreview();
    }
} else {
    // Default to first icon
    const firstIcon = document.querySelector('.icon-option');
    if (firstIcon) {
        firstIcon.classList.add('selected');
    }
}

// Icon selection
document.querySelectorAll('.icon-option').forEach(option => {
    option.addEventListener('click', () => {
        document.querySelectorAll('.icon-option').forEach(opt => opt.classList.remove('selected'));
        option.classList.add('selected');
        selectedIcon = option.dataset.icon;
        updatePreview();
    });
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

// If editing and color is not a preset, set custom color input
if (editingGroup && editingGroup.color) {
    const presetColors = ["#A16340","#7F0000","#914576","#6E9859","#5F82A5","#4452A6","#6A6599","#515151"];
    if (!presetColors.includes(editingGroup.color)) {
        customColorInput.value = editingGroup.color;
        customColorInput.parentElement.classList.add('selected');
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
        color: selectedColor,
        iconType: selectedIcon
    };
    
    if (!groupData.name || !groupData.color || !groupData.iconType) {
        alert('Please fill in all required fields');
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
    
    if (nameInput.value && selectedColor && selectedIcon) {
        preview.style.display = 'block';
        previewName.textContent = nameInput.value;
        
        // Get the SVG from the selected icon
        const selectedIconElement = document.querySelector('.icon-option[data-icon="' + selectedIcon + '"] svg');
        if (selectedIconElement) {
            const svgClone = selectedIconElement.cloneNode(true);
            svgClone.setAttribute('width', '16');
            svgClone.setAttribute('height', '16');
            svgClone.setAttribute('stroke', selectedColor);
            previewIcon.innerHTML = '';
            previewIcon.appendChild(svgClone);
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
