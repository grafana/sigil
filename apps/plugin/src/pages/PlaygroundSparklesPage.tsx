import React from 'react';
import { css } from '@emotion/css';
import { useStyles2 } from '@grafana/ui';
import { SparklesBackground } from '../components/landing/SparklesBackground';

export default function PlaygroundSparklesPage() {
  const styles = useStyles2(getStyles);

  return (
    <div className={styles.page}>
      <SparklesBackground className={styles.sparklesLayer} withGradient />
    </div>
  );
}

function getStyles() {
  return {
    page: css({
      position: 'relative',
      width: '100%',
      minHeight: '100vh',
      overflow: 'hidden',
      borderRadius: 0,
    }),
    sparklesLayer: css({
      position: 'absolute',
      inset: 0,
      zIndex: 1,
    }),
  };
}
