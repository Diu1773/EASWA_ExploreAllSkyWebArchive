export interface Category {
  id: string;
  label: string;
  description: string;
  topicIds: string[];
  comingSoon?: boolean;
}

export const CATEGORIES: Category[] = [
  {
    id: 'change',
    label: '변화와 주기',
    description: '시간에 따라 달라지는 천체의 밝기와 모습을 데이터로 탐구합니다.',
    topicIds: ['eclipsing_binary', 'variable_star', 'exoplanet_transit'],
  },
  {
    id: 'distribution',
    label: '분포와 비교',
    description: '여러 천체의 특성을 비교하고, 분포 속에서 공통점과 차이를 읽어냅니다.',
    topicIds: [],
    comingSoon: true,
  },
  {
    id: 'relation',
    label: '관계와 법칙',
    description: '그래프와 데이터를 통해 천문 현상 사이의 관계를 해석합니다.',
    topicIds: [],
    comingSoon: true,
  },
  {
    id: 'structure',
    label: '구조와 해석',
    description: '이미지를 바탕으로 천체와 우주 구조의 특징을 탐색합니다.',
    topicIds: [],
    comingSoon: true,
  },
];
