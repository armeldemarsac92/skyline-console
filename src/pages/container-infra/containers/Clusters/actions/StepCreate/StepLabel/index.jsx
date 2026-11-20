// Copyright 2021 99cloud
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import Base from 'components/Form';
import { inject, observer } from 'mobx-react';
import KeyValueInput from 'components/FormItem/KeyValueInput';
import {
  autoscalingBoundsError,
  workerCountError,
} from 'resources/magnum/lifecycle';

export class StepLabel extends Base {
  get title() {
    return t('Labels');
  }

  get name() {
    return t('Labels');
  }

  get defaultValue() {
    return { labelMode: 'merge', additionalLabels: [] };
  }

  get formItems() {
    return [
      {
        name: 'labelMode',
        label: t('Template Labels'),
        type: 'select',
        options: [
          { label: t('Merge with template labels'), value: 'merge' },
          { label: t('Replace Magnum labels'), value: 'replace' },
        ],
        tip: t(
          'CAPI Helm also reads settings from the template. Set a value explicitly to override it.'
        ),
      },
      {
        name: 'additionalLabels',
        label: t('Additional Labels'),
        type: 'add-select',
        itemComponent: KeyValueInput,
        addText: t('Add Label'),
        validator: (_, additionalLabels) => {
          const { context } = this.props;
          const values = { ...context, additionalLabels };
          const error =
            workerCountError(values, true) || autoscalingBoundsError(values);
          return error ? Promise.reject(new Error(error)) : Promise.resolve();
        },
        onChange: (value) => {
          this.updateContext({
            additionalLabels: value,
          });
        },
      },
    ];
  }
}

export default inject('rootStore')(observer(StepLabel));
