import React from 'react';
import type { EvaluationDataSource } from '../../evaluation/api';
import type { ForkTemplateRequest } from '../../evaluation/types';
import ForkEvaluatorForm from './ForkEvaluatorForm';

export type ForkTemplateFormProps = {
  templateID: string;
  onSubmit: (req: ForkTemplateRequest) => void;
  onCancel: () => void;
  dataSource: Pick<EvaluationDataSource, 'listJudgeProviders' | 'listJudgeModels'>;
};

export default function ForkTemplateForm({ templateID, onSubmit, onCancel, dataSource }: ForkTemplateFormProps) {
  return (
    <ForkEvaluatorForm
      templateID={templateID}
      onSubmit={onSubmit}
      onCancel={onCancel}
      dataSource={dataSource}
      copy={{
        formLabel: 'Fork template to evaluator',
        idDescription: 'Unique ID for the evaluator created from this template.',
        providerDescription: 'Optional. Override the LLM provider for llm_judge templates.',
        modelDescription: 'Optional. Override the model for llm_judge templates.',
        submitLabel: 'Fork to Evaluator',
      }}
    />
  );
}
