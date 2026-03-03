import React, { useState } from 'react';
import SampleRateInput from '../../components/evaluation/SampleRateInput';

function SampleRateInputWrapper() {
  const [value, setValue] = useState(0.1);
  return <SampleRateInput value={value} onChange={setValue} />;
}

const meta = {
  title: 'Sigil/Evaluation/SampleRateInput',
  component: SampleRateInput,
};

export default meta;

export const Default = {
  render: () => <SampleRateInputWrapper />,
};

export const TenPercent = {
  args: {
    value: 0.1,
    onChange: () => {},
  },
};

export const HundredPercent = {
  args: {
    value: 1,
    onChange: () => {},
  },
};

export const ZeroPercent = {
  args: {
    value: 0,
    onChange: () => {},
  },
};
