import React, { useState } from 'react';
import { Contract, ContractContext } from '../../types';
import { apply_contract_context } from '../../tools/contract';

interface ContractEditorProps {
  initialContract: Contract;
}

const ContractEditor: React.FC<ContractEditorProps> = ({ initialContract }) => {
  const [contract, setContract] = useState<Contract>(initialContract);
  const [context, setContext] = useState<ContractContext>({});
  const [preview, setPreview] = useState<Contract | null>(null);
  const [message, setMessage] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const handleContextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    try {
      const newContext = JSON.parse(e.target.value);
      setContext(newContext);
    } catch (error) {
      console.error('Invalid JSON:', error);
    }
  };

  const handleApplyContext = async (dryRun: boolean) => {
    setIsLoading(true);
    try {
      const result = await apply_contract_context(contract, context, dryRun);
      setMessage(result.message);

      if (dryRun && result.preview) {
        setPreview(result.preview);
      } else if (result.success) {
        setContract(result.preview || contract);
        setPreview(null);
      }
    } catch (error) {
      setMessage(`Error: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="contract-editor">
      <h2>Contract Editor</h2>

      <div className="editor-section">
        <h3>Current Contract</h3>
        <pre>{JSON.stringify(contract, null, 2)}</pre>
      </div>

      <div className="editor-section">
        <h3>Context</h3>
        <textarea
          value={JSON.stringify(context, null, 2)}
          onChange={handleContextChange}
          rows={10}
          cols={50}
        />
      </div>

      <div className="button-group">
        <button
          onClick={() => handleApplyContext(true)}
          disabled={isLoading}
        >
          {isLoading ? 'Processing...' : 'Preview Changes'}
        </button>
        <button
          onClick={() => handleApplyContext(false)}
          disabled={isLoading}
        >
          {isLoading ? 'Processing...' : 'Apply Changes'}
        </button>
      </div>

      {message && <div className="message">{message}</div>}

      {preview && (
        <div className="preview-section">
          <h3>Preview</h3>
          <pre>{JSON.stringify(preview, null, 2)}</pre>
        </div>
      )}
    </div>
  );
};

export default ContractEditor;