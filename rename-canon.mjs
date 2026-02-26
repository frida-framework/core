import fs from 'fs';
import path from 'path';

const walk = (dir, filelist = []) => {
    const files = fs.readdirSync(dir);
    for (const file of files) {
        if (dir.includes('node_modules') || dir.includes('.git') || dir.includes('dist')) continue;
        const filepath = path.join(dir, file);
        if (fs.statSync(filepath).isDirectory()) {
            filelist = walk(filepath, filelist);
        } else {
            filelist.push(filepath);
        }
    }
    return filelist;
};

const targetDirs = ['./src', './scripts', './contract'];
const files = [];
for (const d of targetDirs) {
    if (fs.existsSync(d) && fs.statSync(d).isDirectory()) {
        files.push(...walk(d));
    }
}
files.push('package.json');

let modifiedFiles = 0;
for (const file of files) {
    if (!file.match(/\.(ts|mts|js|mjs|json|yaml|yml|md)$/)) continue;
    if (file.includes('rename-canon.mjs')) continue;

    let content = fs.readFileSync(file, 'utf8');
    const og = content;

    // Replace Canon -> Contract
    content = content.replace(/Canon/g, 'Contract');
    // Replace CANON -> CONTRACT
    content = content.replace(/CANON/g, 'CONTRACT');
    // Replace canon -> contract
    content = content.replace(/canon/g, 'contract');

    if (og !== content) {
        fs.writeFileSync(file, content, 'utf8');
        console.log(`Updated content in ${file}`);
        modifiedFiles++;
    }
}

// Rename files that have canon in their name
for (const file of files) {
    if (file.includes('canon')) {
        const newName = file.replace(/canon/g, 'contract');
        fs.renameSync(file, newName);
        console.log(`Renamed file ${file} to ${newName}`);
    }
}

console.log(`Completed. Updated content in ${modifiedFiles} files.`);
