import start from './start';
import branch from './branch';
import behavior from './behavior';

const cellMap = {
    'sami-start': start,
    'sami-branch': branch,
    'sami-behavior': behavior
};

export const install = () => {
    Object.entries(cellMap).forEach(([, cell]) => {
        Vue.component(cell.name, cell);
    });
};

export default cellMap;