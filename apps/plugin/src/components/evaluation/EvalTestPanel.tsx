import React, { useEffect, useRef, useState } from 'react';
import { css, keyframes } from '@emotion/css';
import type { GrafanaTheme2, SelectableValue } from '@grafana/data';
import { Alert, Button, Field, Icon, Select, Spinner, Stack, Text, useStyles2 } from '@grafana/ui';
import { defaultConversationsDataSource, type ConversationsDataSource } from '../../conversation/api';
import type { GenerationLookupHints } from '../../conversation/types';
import type { GenerationDetail, Message } from '../../generation/types';
import { defaultEvaluationDataSource, type EvaluationDataSource } from '../../evaluation/api';
import type { EvalOutputKey, EvalTestResponse, EvaluatorKind } from '../../evaluation/types';
import ChatMessage from '../chat/ChatMessage';
import GenerationPicker from './GenerationPicker';
import TestResultDisplay from './TestResultDisplay';

export type EvalTestPanelProps = {
  kind: EvaluatorKind;
  config: Record<string, unknown>;
  outputKeys: EvalOutputKey[];
  dataSource?: EvaluationDataSource;
  conversationsDataSource?: ConversationsDataSource;
};

const GRADIENT_PURPLE = 'rgb(168, 85, 247)';
const GRADIENT_ORANGE = 'rgb(249, 115, 22)';

function createBorderAnimation(backgroundColor: string): Record<string, { backgroundImage: string }> {
  const frames: Record<string, { backgroundImage: string }> = {};
  for (let i = 0; i <= 100; i += 5) {
    frames[`${i}%`] = {
      backgroundImage: `
        linear-gradient(${backgroundColor}, ${backgroundColor}),
        conic-gradient(from ${i * 3.6}deg, transparent 60%, ${GRADIENT_PURPLE} 80%, ${GRADIENT_ORANGE} 100%, transparent 15%)
      `,
    };
  }
  return frames;
}

const getStyles = (theme: GrafanaTheme2) => {
  const bg = theme.colors.background.primary;
  const borderAnimation = keyframes({
    label: 'run-button-border',
    ...createBorderAnimation(bg),
  });

  return {
    card: css({
      flex: 1,
      minHeight: 0,
      display: 'flex',
      flexDirection: 'column' as const,
      overflow: 'hidden',
      background: theme.colors.background.primary,
      boxShadow: theme.shadows.z1,
      borderRadius: '6px',
    }),
    header: css({
      display: 'flex',
      alignItems: 'center',
      gap: theme.spacing(1),
      padding: theme.spacing(2),
      borderBottom: `1px solid ${theme.colors.border.medium}`,
      background: theme.colors.background.secondary,
      flexShrink: 0,
    }),
    body: css({
      display: 'flex',
      flexDirection: 'column' as const,
      flex: 1,
      minHeight: 0,
      overflowY: 'auto' as const,
      gap: theme.spacing(1.5),
      padding: theme.spacing(2),
      background: theme.colors.background.primary,
    }),
    previewThread: css({
      display: 'flex',
      flexDirection: 'column' as const,
      gap: theme.spacing(1.5),
      flex: 1,
      minHeight: 0,
      overflowY: 'auto' as const,
      padding: theme.spacing(1),
      background: theme.colors.background.canvas,
      border: `1px solid ${theme.colors.border.weak}`,
      borderRadius: theme.shape.radius.default,
    }),
    runButtonWrapper: css({
      display: 'inline-block',
      alignSelf: 'flex-start',
    }),
    runButtonGlow: css({
      borderRadius: theme.shape.radius.default,
      border: '2px solid transparent',
      backgroundImage: `
      linear-gradient(${bg}, ${bg}),
      conic-gradient(from 0deg, transparent 60%, ${GRADIENT_PURPLE} 80%, ${GRADIENT_ORANGE} 100%, transparent 15%)
    `,
      backgroundOrigin: 'border-box',
      backgroundClip: 'padding-box, border-box',
      animation: `${borderAnimation} 2s linear infinite`,
    }),
  };
};

export default function EvalTestPanel({
  kind,
  config,
  outputKeys,
  dataSource,
  conversationsDataSource,
}: EvalTestPanelProps) {
  const styles = useStyles2(getStyles);
  const ds = dataSource ?? defaultEvaluationDataSource;
  const convDs = conversationsDataSource ?? defaultConversationsDataSource;

  const [generationId, setGenerationId] = useState<string | undefined>();
  const generationLookupHintsRef = useRef<GenerationLookupHints | undefined>(undefined);
  const [generation, setGeneration] = useState<GenerationDetail | null>(null);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<EvalTestResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Provider / model state for llm_judge
  const [providerOptions, setProviderOptions] = useState<Array<SelectableValue<string>>>([]);
  const [modelOptions, setModelOptions] = useState<Array<SelectableValue<string>>>([]);
  const [provider, setProvider] = useState<string | null>(null);
  const [model, setModel] = useState<string | null>(null);

  // Load providers on mount
  useEffect(() => {
    void ds
      .listJudgeProviders()
      .then((res) => {
        setProviderOptions(res.providers.map((p) => ({ label: p.name, value: p.id })));
      })
      .catch(() => {});
  }, [ds]);

  // Load models when provider changes
  useEffect(() => {
    if (!provider) {
      setModelOptions([]);
      return;
    }
    void ds
      .listJudgeModels(provider)
      .then((res) => {
        setModelOptions(res.models.map((m) => ({ label: m.name, value: m.id })));
      })
      .catch(() => {});
  }, [ds, provider]);

  // Load generation detail for preview when selected; clear results on change
  useEffect(() => {
    setResult(null);
    setError(null);
    if (!generationId) {
      setGeneration(null);
      return;
    }
    void convDs
      .getGeneration(generationId, generationLookupHintsRef.current)
      .then(setGeneration)
      .catch(() => setGeneration(null));
  }, [generationId, convDs]);

  const handleRun = async () => {
    if (!generationId) {
      return;
    }
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      // Merge provider/model into config for llm_judge
      let testConfig = config;
      if (kind === 'llm_judge' && (provider || model)) {
        testConfig = { ...config };
        if (provider) {
          testConfig.provider = provider;
        }
        if (model) {
          testConfig.model = model;
        }
      }
      const resp = await ds.testEval({
        kind,
        config: testConfig,
        output_keys: outputKeys,
        generation_id: generationId,
      });
      setResult(resp);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Test failed');
    } finally {
      setRunning(false);
    }
  };

  const allMessages: Message[] = generation ? [...(generation.input ?? []), ...(generation.output ?? [])] : [];

  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <Stack direction="row" gap={1} alignItems="center">
          <Icon name="play" size="sm" />
          <Text weight="medium">Test</Text>
        </Stack>
      </div>

      <div className={styles.body}>
        <Text variant="bodySmall" color="secondary">
          Pick a generation and run this config against it.
        </Text>

        {kind === 'llm_judge' && (
          <Stack direction="row" gap={1}>
            <Field label="Provider">
              <Select<string>
                options={providerOptions}
                value={provider}
                onChange={(v) => {
                  setProvider(v?.value ?? null);
                  setModel(null);
                  setModelOptions([]);
                }}
                isClearable
                placeholder="Default"
                width={16}
              />
            </Field>
            <Field label="Model">
              <Select<string>
                options={modelOptions}
                value={model}
                onChange={(v) => setModel(v?.value ?? null)}
                isClearable
                allowCustomValue
                placeholder="Default"
                width={20}
              />
            </Field>
          </Stack>
        )}

        <GenerationPicker
          onSelect={(id, hints) => {
            generationLookupHintsRef.current = hints;
            setGenerationId(id);
          }}
          selectedGenerationId={generationId}
          conversationsDataSource={convDs}
          evaluationDataSource={ds}
        />

        {generation && (
          <>
            <Text variant="bodySmall" color="secondary">
              {generation.model?.provider ?? ''} {generation.model?.name ?? '\u2014'} &middot;{' '}
              {generation.created_at ? new Date(generation.created_at).toLocaleString() : ''}
            </Text>
            <Text variant="bodySmall" weight="medium">
              Preview test
            </Text>
            {allMessages.length > 0 ? (
              <div className={styles.previewThread}>
                {allMessages.map((msg, i) => (
                  <ChatMessage key={i} message={msg} />
                ))}
              </div>
            ) : (
              <Text variant="bodySmall" color="secondary" italic>
                No messages recorded.
              </Text>
            )}
          </>
        )}

        <span className={`${styles.runButtonWrapper} ${running ? styles.runButtonGlow : ''}`}>
          <Button
            onClick={handleRun}
            disabled={!generationId || running}
            icon={running ? undefined : 'play'}
            variant="primary"
          >
            {running ? (
              <>
                <Spinner inline /> Running&hellip;
              </>
            ) : (
              'Run test'
            )}
          </Button>
        </span>

        {error && (
          <Alert severity="error" title="Test failed">
            {error}
          </Alert>
        )}
        {result && <TestResultDisplay result={result} />}
      </div>
    </div>
  );
}
