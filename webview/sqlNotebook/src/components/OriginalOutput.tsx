import React from 'react';
import { CellOutput } from '../types';

interface OriginalOutputProps {
  output: CellOutput;
}

const OriginalOutput: React.FC<OriginalOutputProps> = ({ output }) => {
  if (output.output_type === 'error') {
    return (
      <div className="output-error">
        {output.ename}: {output.evalue}
        {output.traceback && <pre>{output.traceback.join('\n')}</pre>}
      </div>
    );
  }

  if (output.output_type === 'stream' && output.text) {
    return (
      <div className="output-content">
        <pre>{output.text.join('')}</pre>
      </div>
    );
  }

  if (output.data) {
    const text = output.data['text/plain'];
    if (text) {
      return (
        <div className="output-content">
          <pre>{text.join('')}</pre>
        </div>
      );
    }
  }

  return null;
};

export default OriginalOutput;
