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
      width: 'calc(100% + 32px)',
      minHeight: '100vh',
      marginLeft: -16,
      marginRight: -16,
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
